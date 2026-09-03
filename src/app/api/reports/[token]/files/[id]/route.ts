import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { loadReportFile, resolveReportPayload } from '@/lib/report-data';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.zip': 'application/zip',
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await params;
    const payload = await resolveReportPayload(token);
    if (!payload) return NextResponse.json({ error: '报告链接无效' }, { status: 404 });
    const fileId = Number(id);
    if (!Number.isInteger(fileId) || fileId <= 0) return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    const file = loadReportFile(payload, fileId);
    if (!file || !fs.existsSync(file.storagePath)) return NextResponse.json({ error: '文件不存在' }, { status: 404 });

    const extension = (file.fileType || path.extname(file.originalName)).toLowerCase();
    const inline = extension.match(/^\.(png|jpe?g|gif|bmp|webp|svg|pdf)$/);
    const size = fs.statSync(file.storagePath).size;
    const body = Readable.toWeb(fs.createReadStream(file.storagePath)) as ReadableStream;
    return new NextResponse(body, {
      headers: {
        'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(size),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Read report file error:', error);
    return NextResponse.json({ error: '读取报告文件失败' }, { status: 500 });
  }
}
