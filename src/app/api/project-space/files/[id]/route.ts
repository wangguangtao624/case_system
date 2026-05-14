import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
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
      SELECT pf.*, p.publish_status
      FROM project_space_files pf
      JOIN projects p ON pf.project_id = p.id
      WHERE pf.id = ?
    `).get(fileId) as {
      id: number;
      original_name: string;
      storage_path: string;
      publish_status: string;
    } | undefined;

    if (!file) return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    if (file.publish_status === 'draft' && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
    }
    if (!fs.existsSync(file.storage_path)) return NextResponse.json({ error: '文件已被删除' }, { status: 404 });

    const buffer = fs.readFileSync(file.storage_path);
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.original_name)}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Download project space file error:', error);
    return NextResponse.json({ error: '下载项目空间文件失败' }, { status: 500 });
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

    if (!originalName || !String(originalName).trim()) {
      return NextResponse.json({ error: '文件名不能为空' }, { status: 400 });
    }

    const db = getDb();
    const file = db.prepare(`
      SELECT pf.id, p.is_archived, p.publish_status
      FROM project_space_files pf
      JOIN projects p ON pf.project_id = p.id
      WHERE pf.id = ?
    `).get(fileId) as { id: number; is_archived: number; publish_status: string } | undefined;

    if (!file) return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    if (file.publish_status === 'draft' && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
    }
    if (file.is_archived === 1 && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '归档项目不允许重命名文件' }, { status: 403 });
    }

    db.prepare('UPDATE project_space_files SET original_name = ? WHERE id = ?').run(String(originalName).trim(), fileId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Rename project space file error:', error);
    return NextResponse.json({ error: '重命名项目空间文件失败' }, { status: 500 });
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
      SELECT pf.id, pf.storage_path, p.is_archived, p.publish_status
      FROM project_space_files pf
      JOIN projects p ON pf.project_id = p.id
      WHERE pf.id = ?
    `).get(fileId) as { id: number; storage_path: string; is_archived: number; publish_status: string } | undefined;

    if (!file) return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    if (file.publish_status === 'draft' && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
    }
    if (file.is_archived === 1 && !isManagerUser(user.username)) {
      return NextResponse.json({ error: '归档项目不允许删除文件' }, { status: 403 });
    }

    try {
      if (fs.existsSync(file.storage_path)) fs.unlinkSync(file.storage_path);
    } catch { /* ignore fs cleanup */ }

    db.prepare('DELETE FROM project_space_files WHERE id = ?').run(fileId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete project space file error:', error);
    return NextResponse.json({ error: '删除项目空间文件失败' }, { status: 500 });
  }
}
