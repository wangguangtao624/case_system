import { NextRequest, NextResponse } from 'next/server';
import { getDb, getStoragePath } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';
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
      SELECT f.*, p.publish_status FROM files f
      JOIN cases c ON f.case_id = c.id
      JOIN modules m ON c.module_id = m.id
      JOIN projects p ON m.project_id = p.id
      WHERE f.id = ?
    `).get(fileId) as {
      id: number;
      case_id: number;
      filename: string;
      original_name: string;
      file_size: number;
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

    const buffer = fs.readFileSync(file.storage_path);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.original_name)}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Download file error:', error);
    return NextResponse.json({ error: '下载文件失败' }, { status: 500 });
  }
}

export async function DELETE(
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
      SELECT f.*, p.is_archived, p.publish_status FROM files f
      JOIN cases c ON f.case_id = c.id
      JOIN modules m ON c.module_id = m.id
      JOIN projects p ON m.project_id = p.id
      WHERE f.id = ?
    `).get(fileId) as {
      id: number;
      storage_path: string;
      is_archived: number;
      publish_status: string;
    } | undefined;

    if (!file) return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    if (file.publish_status === 'draft' && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
    }

    if (file.is_archived === 1) {
      if (!isManagerUser(user.username)) {
        return NextResponse.json({ error: '归档项目不允许删除文件' }, { status: 403 });
      }
    }

    try {
      if (fs.existsSync(file.storage_path)) fs.unlinkSync(file.storage_path);
    } catch { /* ignore */ }

    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete file error:', error);
    return NextResponse.json({ error: '删除文件失败' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { id } = await params;
    const fileId = Number(id);

    const { originalName } = await request.json();
    if (!originalName) return NextResponse.json({ error: '参数错误' }, { status: 400 });

    const db = getDb();

    const fileCheck = db.prepare(`
      SELECT p.is_archived, p.publish_status FROM files f
      JOIN cases c ON f.case_id = c.id
      JOIN modules m ON c.module_id = m.id
      JOIN projects p ON m.project_id = p.id
      WHERE f.id = ?
    `).get(fileId) as { is_archived: number; publish_status: string } | undefined;

    if (fileCheck?.publish_status === 'draft' && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
    }

    if (fileCheck?.is_archived === 1) {
      if (!isManagerUser(user.username)) {
        return NextResponse.json({ error: '归档项目不允许重命名文件' }, { status: 403 });
      }
    }

    db.prepare('UPDATE files SET original_name = ? WHERE id = ?').run(originalName, fileId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Rename file error:', error);
    return NextResponse.json({ error: '重命名文件失败' }, { status: 500 });
  }
}
