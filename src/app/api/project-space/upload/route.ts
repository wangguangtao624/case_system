import { NextRequest, NextResponse } from 'next/server';
import { getDb, getStoragePath } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import archiver from 'archiver';

const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const formData = await request.formData();
    const projectId = Number(formData.get('projectId'));
    const targetSpace = (formData.get('targetSpace') as string) || 'public';
    const files = formData.getAll('files') as File[];

    if (!projectId || files.length === 0) {
      return NextResponse.json({ error: '缺少项目ID或文件' }, { status: 400 });
    }

    if (targetSpace !== 'public' && targetSpace !== 'personal') {
      return NextResponse.json({ error: '上传空间参数无效' }, { status: 400 });
    }

    const db = getDb();
    const project = db.prepare(`
      SELECT id, is_archived
      FROM projects
      WHERE id = ?
    `).get(projectId) as { id: number; is_archived: number } | undefined;

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    if (project.is_archived === 1 && !MANAGER_USERNAMES.includes(user.username)) {
      return NextResponse.json({ error: '归档项目不允许上传项目空间文件' }, { status: 403 });
    }

    const storageRoot = getStoragePath();
    const baseDir = targetSpace === 'public'
      ? path.join(storageRoot, 'project-spaces', String(projectId), 'public')
      : path.join(storageRoot, 'project-spaces', String(projectId), 'personal', String(user.id));
    fs.mkdirSync(baseDir, { recursive: true });

    const folderNameField = formData.get('folderName') as string | null;
    const filePathsRaw = formData.get('filePaths') as string | null;
    const filePaths: Record<string, string> = filePathsRaw ? JSON.parse(filePathsRaw) : {};
    const hasFolderStructure = folderNameField
      ? true
      : files.some(file => file.webkitRelativePath && file.webkitRelativePath.includes('/'));

    const uploadedFiles = [];

    if (hasFolderStructure) {
      const folderName = folderNameField || (files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : null) || 'folder';
      const zipFilename = `${crypto.randomUUID()}.zip`;
      const zipOriginalName = `${folderName}.zip`;
      const zipPath = path.join(baseDir, zipFilename);

      const fileEntries: { relativePath: string; buffer: Buffer }[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const buffer = Buffer.from(await file.arrayBuffer());
        const relativePath = filePaths[i] || (file.webkitRelativePath && file.webkitRelativePath.includes('/') ? file.webkitRelativePath : null) || file.name;
        fileEntries.push({ relativePath, buffer });
      }

      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        output.on('close', () => resolve());
        archive.on('error', (err: Error) => reject(err));
        archive.pipe(output);

        for (const entry of fileEntries) {
          archive.append(entry.buffer, { name: entry.relativePath });
        }

        archive.finalize();
      });

      const zipStats = fs.statSync(zipPath);
      const result = db.prepare(`
        INSERT INTO project_space_files (project_id, space_type, owner_user_id, owner_username, filename, original_name, file_size, file_type, storage_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(projectId, targetSpace, user.id, user.username, zipFilename, zipOriginalName, zipStats.size, '.zip', zipPath);

      uploadedFiles.push({
        id: result.lastInsertRowid,
        original_name: zipOriginalName,
        file_size: zipStats.size,
        file_type: '.zip',
      });
    } else {
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const ext = path.extname(file.name) || '';
        const filename = `${crypto.randomUUID()}${ext}`;
        const filePath = path.join(baseDir, filename);
        fs.writeFileSync(filePath, buffer);

        const result = db.prepare(`
          INSERT INTO project_space_files (project_id, space_type, owner_user_id, owner_username, filename, original_name, file_size, file_type, storage_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(projectId, targetSpace, user.id, user.username, filename, file.name, buffer.length, ext, filePath);

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
    console.error('Upload project space files error:', error);
    return NextResponse.json({ error: '上传项目空间文件失败' }, { status: 500 });
  }
}
