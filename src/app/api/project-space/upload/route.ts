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
  if (!message) return '上传项目空间文件失败';
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

    let projectId = 0;
    let targetSpace: 'public' | 'personal' = 'public';
    let folderName = '';
    let filePaths: Record<string, string> = {};
    let fieldsReady = false;
    let filesCount = 0;
    let baseDir = '';
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
      if (!projectId) {
        throw new Error('缺少项目ID');
      }
      if (targetSpace !== 'public' && targetSpace !== 'personal') {
        throw new Error('上传空间参数无效');
      }
      if (fieldsReady) return;

      const project = db.prepare(`
        SELECT id, is_archived, publish_status
        FROM projects
        WHERE id = ?
      `).get(projectId) as { id: number; is_archived: number; publish_status: string } | undefined;

      if (!project) {
        throw new Error('项目不存在');
      }
      if (project.publish_status === 'draft' && !isManagerUser(user.username)) {
        throw new Error('未发布项目暂不可见');
      }
      if (project.is_archived === 1 && !isManagerUser(user.username) && targetSpace !== 'personal') {
        throw new Error('归档项目仅支持上传到个人空间');
      }

      const storageRoot = getStoragePath();
      baseDir = targetSpace === 'public'
        ? path.join(storageRoot, 'project-spaces', String(projectId), 'public')
        : path.join(storageRoot, 'project-spaces', String(projectId), 'personal', String(user.id));
      fs.mkdirSync(baseDir, { recursive: true });
      hasFolderStructure = Boolean(folderName || Object.keys(filePaths).length > 0);
      fieldsReady = true;
    };

    await consumeMultipartRequest(request, {
      onField(name, value) {
        if (name === 'projectId') {
          projectId = Number(value);
          return;
        }
        if (name === 'targetSpace') {
          targetSpace = value === 'personal' ? 'personal' : 'public';
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
            zipPath = path.join(baseDir, zipFilename);
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
        const storedPath = path.join(baseDir, storedName);
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
          INSERT INTO project_space_files (project_id, space_type, owner_user_id, owner_username, filename, original_name, file_size, file_type, storage_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(projectId, targetSpace, user.id, user.username, storedName, originalName, stats.size, ext, storedPath);
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
        INSERT INTO project_space_files (project_id, space_type, owner_user_id, owner_username, filename, original_name, file_size, file_type, storage_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(projectId, targetSpace, user.id, user.username, zipFilename, zipOriginalName, zipStats.size, '.zip', zipPath);
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
      const stmt = db.prepare('DELETE FROM project_space_files WHERE id = ?');
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
    console.error('Upload project space files error:', error);
    return NextResponse.json({ error: getUploadErrorMessage(error) }, { status: 500 });
  }
}
