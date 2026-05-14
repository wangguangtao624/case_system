import { NextRequest, NextResponse } from 'next/server';
import { getDb, getStoragePath } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import archiver from 'archiver';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const formData = await request.formData();
    const caseId = formData.get('caseId') as string;
    const files = formData.getAll('files') as File[];

    if (!caseId || !files || files.length === 0) {
      return NextResponse.json({ error: '缺少用例ID或文件' }, { status: 400 });
    }

    // Verify case exists
    const db = getDb();
    const caseExists = db.prepare(`
      SELECT c.id, p.is_archived, p.publish_status FROM cases c
      JOIN modules m ON c.module_id = m.id
      JOIN projects p ON m.project_id = p.id
      WHERE c.id = ?
    `).get(Number(caseId)) as { id: number; is_archived: number; publish_status: string } | undefined;

    if (!caseExists) {
      return NextResponse.json({ error: '用例不存在' }, { status: 404 });
    }

    if (caseExists.publish_status === 'draft' && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
    }

    if (caseExists.is_archived === 1) {
      if (!isManagerUser(user.username)) {
        return NextResponse.json({ error: '归档项目不允许上传文件' }, { status: 403 });
      }
    }

    const storagePath = getStoragePath();
    const caseDir = path.join(storagePath, caseId);
    if (!fs.existsSync(caseDir)) {
      fs.mkdirSync(caseDir, { recursive: true });
    }

    const uploadedFiles = [];

    // Check if files come from a folder upload:
    // 1. webkitRelativePath is set (from <input webkitdirectory>)
    // 2. folderName field is set (from drag-and-drop directory detection)
    const folderNameField = formData.get('folderName') as string | null;
    const filePathsRaw = formData.get('filePaths') as string | null;
    const filePaths: Record<string, string> = filePathsRaw ? JSON.parse(filePathsRaw) : {};
    const hasFolderStructure = folderNameField
      ? true
      : files.some(f => f.webkitRelativePath && f.webkitRelativePath.includes('/'));

    if (hasFolderStructure) {
      // Compress folder into a zip file
      const folderName = folderNameField || (files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : null) || 'folder';
      const zipFilename = `${crypto.randomUUID()}.zip`;
      const zipFilePath = path.join(caseDir, zipFilename);
      const zipOriginalName = `${folderName}.zip`;

      // Collect all files with their relative paths
      const fileEntries: { relativePath: string; buffer: Buffer }[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const buffer = Buffer.from(await file.arrayBuffer());
        // Priority: filePaths by index > webkitRelativePath > file name
        const relativePath = filePaths[i] || (file.webkitRelativePath && file.webkitRelativePath.includes('/') ? file.webkitRelativePath : null) || file.name;
        fileEntries.push({ relativePath, buffer });
      }

      // Create zip using archiver
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        output.on('close', () => resolve());
        archive.on('error', (err: Error) => reject(err));

        archive.pipe(output);

        for (const entry of fileEntries) {
          archive.append(entry.buffer, { name: entry.relativePath });
        }

        archive.finalize();
      });

      const zipStats = fs.statSync(zipFilePath);

      const result = db.prepare(`
        INSERT INTO files (case_id, filename, original_name, file_size, file_type, storage_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(Number(caseId), zipFilename, zipOriginalName, zipStats.size, '.zip', zipFilePath);

      uploadedFiles.push({
        id: result.lastInsertRowid,
        original_name: zipOriginalName,
        file_size: zipStats.size,
        file_type: '.zip',
      });
    } else {
      // Regular file upload - store individually
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const ext = path.extname(file.name) || '';
        const filename = `${crypto.randomUUID()}${ext}`;
        const filePath = path.join(caseDir, filename);

        fs.writeFileSync(filePath, buffer);

        const result = db.prepare(`
          INSERT INTO files (case_id, filename, original_name, file_size, file_type, storage_path)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(Number(caseId), filename, file.name, buffer.length, ext, filePath);

        uploadedFiles.push({
          id: result.lastInsertRowid,
          original_name: file.name,
          file_size: buffer.length,
          file_type: ext,
        });
      }
    }

    return NextResponse.json({ success: true, files: uploadedFiles });
  } catch (error) {
    console.error('Upload files error:', error);
    return NextResponse.json({ error: '上传文件失败' }, { status: 500 });
  }
}
