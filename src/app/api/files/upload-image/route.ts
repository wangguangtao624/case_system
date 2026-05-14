import { NextRequest, NextResponse } from 'next/server';
import { getDb, getStoragePath } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const formData = await request.formData();
    const caseId = formData.get('caseId') as string;
    const imageFile = formData.get('image') as File;

    if (!caseId || !imageFile) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    // Verify case exists
    const db = getDb();
    const caseExists = db.prepare(`
      SELECT c.id, p.publish_status FROM cases c
      JOIN modules m ON c.module_id = m.id
      JOIN projects p ON m.project_id = p.id
      WHERE c.id = ?
    `).get(Number(caseId)) as { id: number; publish_status: string } | undefined;

    if (!caseExists) {
      return NextResponse.json({ error: '用例不存在' }, { status: 404 });
    }
    if (caseExists.publish_status === 'draft' && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
    }

    const storagePath = getStoragePath();
    const caseDir = path.join(storagePath, caseId);
    if (!fs.existsSync(caseDir)) {
      fs.mkdirSync(caseDir, { recursive: true });
    }

    const buffer = Buffer.from(await imageFile.arrayBuffer());
    const ext = path.extname(imageFile.name) || '.png';
    const filename = `${crypto.randomUUID()}${ext}`;
    const filePath = path.join(caseDir, filename);

    fs.writeFileSync(filePath, buffer);

    const result = db.prepare(`
      INSERT INTO files (case_id, filename, original_name, file_size, file_type, storage_path, source)
      VALUES (?, ?, ?, ?, ?, ?, 'editor')
    `).run(Number(caseId), filename, imageFile.name, buffer.length, ext, filePath);

    return NextResponse.json({
      success: true,
      fileId: result.lastInsertRowid,
      url: `/api/files/preview/${result.lastInsertRowid}`,
      originalName: imageFile.name,
    });
  } catch (error) {
    console.error('Upload image error:', error);
    return NextResponse.json({ error: '图片上传失败' }, { status: 500 });
  }
}
