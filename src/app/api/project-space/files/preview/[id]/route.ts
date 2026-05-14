import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import fs from 'fs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { id } = await params;
    const fileId = Number(id);
    const db = getDb();
    const file = db.prepare(`
      SELECT pf.*
      FROM project_space_files pf
      JOIN projects p ON pf.project_id = p.id
      WHERE pf.id = ?
    `).get(fileId) as {
      id: number;
      original_name: string;
      file_type: string;
      storage_path: string;
    } | undefined;

    if (!file) return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    if (!fs.existsSync(file.storage_path)) return NextResponse.json({ error: '文件已被删除' }, { status: 404 });

    const ext = file.file_type.toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext);
    const isText = ['.txt', '.log', '.csv', '.json', '.xml', '.yaml', '.yml', '.md', '.ini', '.conf', '.cfg', '.properties'].includes(ext);

    if (isImage) {
      const buffer = fs.readFileSync(file.storage_path);
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
      };
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    if (isText) {
      const content = fs.readFileSync(file.storage_path, 'utf-8');
      const preview = content.substring(0, 50000);
      return NextResponse.json({
        content: preview,
        filename: file.original_name,
        truncated: content.length > 50000,
      });
    }

    return NextResponse.json({ error: '该文件类型不支持预览，请下载后查看' }, { status: 400 });
  } catch (error) {
    console.error('Preview project space file error:', error);
    return NextResponse.json({ error: '预览项目空间文件失败' }, { status: 500 });
  }
}
