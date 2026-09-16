import { NextRequest, NextResponse } from 'next/server';
import { getDb, getStoragePath } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';
import { consumeMultipartRequest } from '@/lib/multipart';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let uploadedPath = '';

  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const db = getDb();
    let caseId = 0;
    let originalName = '';
    let storedName = '';
    let extension = '';
    let uploadedSize = 0;
    let imageReceived = false;

    await consumeMultipartRequest(request, {
      // Leave a small amount of multipart framing headroom. The vendored
      // parser emits its limit event when the threshold itself is reached.
      limits: { fields: 2, files: 2, parts: 4 },
      onField(name, value) {
        if (name === 'caseId') caseId = Number(value);
      },
      async onFile(file) {
        if (file.fieldName !== 'image') {
          file.stream.resume();
          return;
        }
        if (imageReceived) {
          file.stream.resume();
          throw new Error('每次只能上传一张图片');
        }
        if (!Number.isInteger(caseId) || caseId <= 0) {
          file.stream.resume();
          throw new Error('缺少用例ID');
        }

        const caseExists = db.prepare(`
          SELECT c.id, p.publish_status FROM cases c
          JOIN modules m ON c.module_id = m.id
          JOIN projects p ON m.project_id = p.id
          WHERE c.id = ?
        `).get(caseId) as { id: number; publish_status: string } | undefined;

        if (!caseExists) {
          file.stream.resume();
          throw new Error('用例不存在');
        }
        if (caseExists.publish_status === 'draft' && !isManagerUser(user.username)) {
          file.stream.resume();
          throw new Error('未发布项目暂不可见');
        }

        imageReceived = true;
        originalName = file.filename || `paste-${Date.now()}.png`;
        extension = path.extname(originalName) || '.png';
        storedName = `${crypto.randomUUID()}${extension}`;

        const caseDir = path.join(getStoragePath(), String(caseId));
        await fs.promises.mkdir(caseDir, { recursive: true });
        uploadedPath = path.join(caseDir, storedName);

        file.stream.on('data', (chunk: Buffer | string) => {
          uploadedSize += Buffer.byteLength(chunk);
        });
        await pipeline(file.stream as NodeJS.ReadableStream, fs.createWriteStream(uploadedPath, { flags: 'wx' }));
      },
    });

    if (!imageReceived || !uploadedPath) {
      return NextResponse.json({ error: '缺少图片' }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO files (case_id, filename, original_name, file_size, file_type, storage_path, source)
      VALUES (?, ?, ?, ?, ?, ?, 'editor')
    `).run(caseId, storedName, originalName, uploadedSize, extension, uploadedPath);

    return NextResponse.json({
      success: true,
      fileId: result.lastInsertRowid,
      url: `/api/files/preview/${result.lastInsertRowid}`,
      originalName,
    });
  } catch (error) {
    if (uploadedPath) {
      try {
        await fs.promises.unlink(uploadedPath);
      } catch {
        // Ignore cleanup errors; the original failure is more useful to log.
      }
    }
    console.error('Upload image error:', error);
    return NextResponse.json({ error: '图片上传失败' }, { status: 500 });
  }
}
