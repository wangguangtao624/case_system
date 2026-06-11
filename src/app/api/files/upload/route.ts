import { NextRequest, NextResponse } from 'next/server';
import { getDb, getStoragePath } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';
import { consumeMultipartRequest } from '@/lib/multipart';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import archiver from 'archiver';

export const runtime = 'nodejs';

function getUploadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (!message) return '上传文件失败';
  const normalized = message.toLowerCase();

  if (normalized.includes('unexpected end of form')) {
    return '上传被中断，请检查网络后重试';
  }
  if (normalized.includes('request entity too large') || normalized.includes('body exceeded')) {
    return '上传内容过大，请拆分后重试';
  }
  if (normalized.includes('no space left on device')) {
    return '服务器存储空间不足，无法完成上传';
  }

  return message;
}

export async function POST(request: NextRequest) {
  const cleanupPaths: string[] = [];
  const insertedIds: number[] = [];

  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    let caseId = 0;
    let folderName = '';
    let filePaths: Record<string, string> = {};
    let caseDir = '';
    let fieldsReady = false;
    let filesCount = 0;
    let hasFolderStructure = false;

    const db = getDb();
    const uploadedFiles: Array<{ id: number | string | bigint; original_name: string; file_size: number; file_type: string }> = [];
    let archive: any = null;
    let archiveOutput: fs.WriteStream | null = null;
    let archiveDone: Promise<void> | null = null;
    let zipPath = '';
    let zipFilename = '';
    let zipOriginalName = '';

    const ensureUploadContext = () => {
      if (!caseId) {
        throw new Error('缺少用例ID');
      }
      if (fieldsReady) return;

      const caseExists = db.prepare(`
        SELECT c.id, p.is_archived, p.publish_status FROM cases c
        JOIN modules m ON c.module_id = m.id
        JOIN projects p ON m.project_id = p.id
        WHERE c.id = ?
      `).get(caseId) as { id: number; is_archived: number; publish_status: string } | undefined;

      if (!caseExists) {
        throw new Error('用例不存在');
      }
      if (caseExists.publish_status === 'draft' && !isManagerUser(user.username)) {
        throw new Error('未发布项目暂不可见');
      }
      if (caseExists.is_archived === 1 && !isManagerUser(user.username)) {
        throw new Error('归档项目不允许上传文件');
      }

      caseDir = path.join(getStoragePath(), String(caseId));
      fs.mkdirSync(caseDir, { recursive: true });
      hasFolderStructure = Boolean(folderName || Object.keys(filePaths).length > 0);
      fieldsReady = true;
    };

    await consumeMultipartRequest(request, {
      onField(name, value) {
        if (name === 'caseId') {
          caseId = Number(value);
          return;
        }
        if (name === 'folderName') {
          folderName = value.trim();
          return;
        }
        if (name === 'filePaths') {
          try {
            filePaths = JSON.parse(value) as Record<string, string>;
          } catch {
            throw new Error('上传失败：文件路径信息损坏，请重新选择文件夹');
          }
        }
      },
      async onFile(file) {
        if (file.fieldName !== 'files') {
          file.stream.resume();
          return;
        }

        ensureUploadContext();
        filesCount += 1;

        if (hasFolderStructure) {
          if (!archive) {
            zipFilename = `${crypto.randomUUID()}.zip`;
            zipOriginalName = `${folderName || 'folder'}.zip`;
            zipPath = path.join(caseDir, zipFilename);
            cleanupPaths.push(zipPath);

            archive = archiver('zip', { zlib: { level: 1 } });
            archiveOutput = fs.createWriteStream(zipPath);
            archiveDone = new Promise<void>((resolve, reject) => {
              archiveOutput!.on('close', resolve);
              archiveOutput!.on('error', reject);
              archive!.on('warning', reject);
              archive!.on('error', reject);
            });
            archive.pipe(archiveOutput);
          }

          const relativePath = filePaths[String(file.index)] || file.filename || `file-${file.index + 1}`;
          archive.append(file.stream as any, { name: relativePath });
          return;
        }

        const originalName = file.filename || `file-${file.index + 1}`;
        const ext = path.extname(originalName) || '';
        const storedName = `${crypto.randomUUID()}${ext}`;
        const storedPath = path.join(caseDir, storedName);
        cleanupPaths.push(storedPath);

        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(storedPath);
          file.stream.on('error', reject);
          output.on('error', reject);
          output.on('finish', resolve);
          file.stream.pipe(output);
        });

        const stats = fs.statSync(storedPath);
        const result = db.prepare(`
          INSERT INTO files (case_id, filename, original_name, file_size, file_type, storage_path)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(caseId, storedName, originalName, stats.size, ext, storedPath);
        insertedIds.push(Number(result.lastInsertRowid));

        uploadedFiles.push({
          id: result.lastInsertRowid,
          original_name: originalName,
          file_size: stats.size,
          file_type: ext,
        });
      },
    });

    ensureUploadContext();

    if (filesCount === 0) {
      return NextResponse.json({ error: '缺少文件' }, { status: 400 });
    }

    const activeArchive: any = archive;
    const activeArchiveDone = archiveDone;
    if (activeArchive && activeArchiveDone) {
      activeArchive.finalize();
      await activeArchiveDone;

      const zipStats = fs.statSync(zipPath);
      const result = db.prepare(`
        INSERT INTO files (case_id, filename, original_name, file_size, file_type, storage_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(caseId, zipFilename, zipOriginalName, zipStats.size, '.zip', zipPath);
      insertedIds.push(Number(result.lastInsertRowid));

      uploadedFiles.push({
        id: result.lastInsertRowid,
        original_name: zipOriginalName,
        file_size: zipStats.size,
        file_type: '.zip',
      });
    }

    return NextResponse.json({ success: true, files: uploadedFiles });
  } catch (error) {
    if (insertedIds.length > 0) {
      const db = getDb();
      const stmt = db.prepare('DELETE FROM files WHERE id = ?');
      for (const id of insertedIds) {
        try {
          stmt.run(id);
        } catch {
          // ignore cleanup failure
        }
      }
    }
    for (const filePath of cleanupPaths) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup failure
      }
    }
    console.error('Upload files error:', error);
    return NextResponse.json({ error: getUploadErrorMessage(error) }, { status: 500 });
  }
}
