import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';
import fs from 'fs';
import { Readable } from 'stream';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
const TEXT_EXTENSIONS = ['.txt', '.log', '.csv', '.json', '.xml', '.yaml', '.yml', '.md', '.ini', '.conf', '.cfg', '.properties'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'];

function getMimeType(ext: string) {
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

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
      SELECT f.*, p.publish_status FROM files f
      JOIN cases c ON f.case_id = c.id
      JOIN modules m ON c.module_id = m.id
      JOIN projects p ON m.project_id = p.id
      WHERE f.id = ?
    `).get(fileId) as {
      id: number;
      filename: string;
      original_name: string;
      file_type: string;
      storage_path: string;
      publish_status: string;
    } | undefined;

    if (!file) return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    if (file.publish_status === 'draft' && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
    }

    if (!fs.existsSync(file.storage_path)) {
      return NextResponse.json({ error: '文件已被删除' }, { status: 404 });
    }

    const ext = file.file_type.toLowerCase();
    const isImage = IMAGE_EXTENSIONS.includes(ext);
    const isText = TEXT_EXTENSIONS.includes(ext);
    const isVideo = VIDEO_EXTENSIONS.includes(ext);

    if (isImage) {
      const buffer = fs.readFileSync(file.storage_path);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': getMimeType(ext),
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    if (isVideo) {
      const stats = fs.statSync(file.storage_path);
      const range = request.headers.get('range');

      if (range) {
        const [startText, endText] = range.replace(/bytes=/, '').split('-');
        const start = Number.parseInt(startText, 10);
        const end = endText ? Number.parseInt(endText, 10) : stats.size - 1;
        const safeStart = Number.isFinite(start) ? start : 0;
        const safeEnd = Number.isFinite(end) ? Math.min(end, stats.size - 1) : stats.size - 1;

        if (safeStart >= stats.size || safeStart > safeEnd) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${stats.size}`,
            },
          });
        }

        const chunkSize = safeEnd - safeStart + 1;
        const stream = fs.createReadStream(file.storage_path, { start: safeStart, end: safeEnd });
        return new NextResponse(Readable.toWeb(stream) as BodyInit, {
          status: 206,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${safeStart}-${safeEnd}/${stats.size}`,
            'Content-Type': getMimeType(ext),
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      const stream = fs.createReadStream(file.storage_path);
      return new NextResponse(Readable.toWeb(stream) as BodyInit, {
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(stats.size),
          'Content-Type': getMimeType(ext),
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    if (isText) {
      const content = fs.readFileSync(file.storage_path, 'utf-8');
      const preview = content.substring(0, 50000);
      return NextResponse.json({ content: preview, filename: file.original_name, truncated: content.length > 50000 });
    }

    return NextResponse.json({ error: '该文件类型不支持预览，请下载后查看' }, { status: 400 });
  } catch (error) {
    console.error('Preview file error:', error);
    return NextResponse.json({ error: '预览文件失败' }, { status: 500 });
  }
}
