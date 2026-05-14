import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!isManagerUser(user.username)) {
      return NextResponse.json({ error: '仅管理者可归档' }, { status: 403 });
    }

    const { projectId, archiveNote } = await request.json();
    if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

    const db = getDb();
    const project = db.prepare('SELECT id, is_archived FROM projects WHERE id = ?').get(projectId) as { id: number; is_archived: number } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    if (project.is_archived) return NextResponse.json({ error: '项目已归档' }, { status: 400 });

    db.prepare(
      "UPDATE projects SET is_archived = 1, publish_status = 'archived', archived_at = datetime('now', 'localtime'), archive_note = ?, archived_by = ? WHERE id = ?"
    ).run(archiveNote || '', user.username, projectId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Archive project error:', error);
    return NextResponse.json({ error: '归档失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (user.role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可删除归档项目' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = Number(searchParams.get('projectId'));
    if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

    const db = getDb();
    const project = db.prepare('SELECT id, is_archived FROM projects WHERE id = ?').get(projectId) as { id: number; is_archived: number } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    if (!project.is_archived) return NextResponse.json({ error: '项目未归档，请使用普通删除' }, { status: 400 });

    const caseIds = db.prepare(`
      SELECT c.id FROM cases c 
      JOIN modules m ON c.module_id = m.id 
      WHERE m.project_id = ?
    `).all(projectId) as { id: number }[];

    const { getStoragePath } = await import('@/lib/db');
    const storagePath = getStoragePath();
    for (const caseId of caseIds) {
      const files = db.prepare('SELECT storage_path FROM files WHERE case_id = ?').all(caseId.id) as { storage_path: string }[];
      for (const file of files) {
        try {
          const fs = await import('fs');
          if (fs.existsSync(file.storage_path)) fs.unlinkSync(file.storage_path);
        } catch { /* ignore */ }
      }
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete archived project error:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (user.role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可修改归档信息' }, { status: 403 });
    }

    const { projectId, archiveNote } = await request.json();
    if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

    const db = getDb();
    const project = db.prepare('SELECT id, is_archived FROM projects WHERE id = ?').get(projectId) as { id: number; is_archived: number } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    if (!project.is_archived) return NextResponse.json({ error: '项目未归档' }, { status: 400 });

    db.prepare('UPDATE projects SET archive_note = ? WHERE id = ?').run(archiveNote || '', projectId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update archive note error:', error);
    return NextResponse.json({ error: '修改归档信息失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const db = getDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    if (status === 'archived') {
      const projects = db.prepare(`
        SELECT p.*, u.username as creator_name
        FROM projects p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.publish_status = 'archived' OR p.is_archived = 1
        ORDER BY p.archived_at DESC
      `).all();
      return NextResponse.json({ projects });
    }

    if (status === 'active') {
      const projects = db.prepare(`
        SELECT p.*, u.username as creator_name
        FROM projects p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.publish_status = 'published' AND p.is_archived = 0
        ORDER BY p.sort_order, p.id
      `).all();
      return NextResponse.json({ projects });
    }

    const projects = db.prepare(`
      SELECT p.*, u.username as creator_name
      FROM projects p
      LEFT JOIN users u ON p.user_id = u.id
      ORDER BY CASE p.publish_status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, p.sort_order, p.id
    `).all();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error('Get archived projects error:', error);
    return NextResponse.json({ error: '获取归档列表失败' }, { status: 500 });
  }
}
