import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const db = getDb();
    const manager = isManagerUser(user.username);
    const query = manager
      ? 'SELECT *, (SELECT username FROM users WHERE id = projects.user_id) as creator_name FROM projects ORDER BY CASE publish_status WHEN \'draft\' THEN 0 WHEN \'published\' THEN 1 ELSE 2 END, sort_order, id'
      : "SELECT *, (SELECT username FROM users WHERE id = projects.user_id) as creator_name FROM projects WHERE publish_status = 'published' ORDER BY sort_order, id";
    const projects = db.prepare(query).all();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error('Get projects error:', error);
    return NextResponse.json({ error: '获取项目列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!isManagerUser(user.username)) {
      return NextResponse.json({ error: '无创建权限' }, { status: 403 });
    }

    const { name } = await request.json();
    if (!name || !name.trim()) {
      return NextResponse.json({ error: '请输入项目名称' }, { status: 400 });
    }

    const db = getDb();
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM projects').get() as { m: number | null };
    const result = db.prepare(`
      INSERT INTO projects (user_id, name, sort_order, is_public, publish_status)
      VALUES (?, ?, ?, 1, 'draft')
    `).run(user.id, name.trim(), (maxOrder.m || 0) + 1);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create project error:', error);
    return NextResponse.json({ error: '创建项目失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!isManagerUser(user.username)) {
      return NextResponse.json({ error: '无修改权限' }, { status: 403 });
    }

    const { id, name, start_date, end_date, priorityMode, action } = await request.json();
    if (!id) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as { id: number; publish_status?: string } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    if (action === 'publish') {
      db.prepare(`
        UPDATE projects
        SET publish_status = 'published',
            is_archived = 0,
            published_at = datetime('now', 'localtime'),
            published_by = ?
        WHERE id = ?
      `).run(user.username, id);
      return NextResponse.json({ success: true, publishStatus: 'published' });
    }

    if (name !== undefined && name !== null) {
      if (!name.trim()) return NextResponse.json({ error: '项目名称不能为空' }, { status: 400 });
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name.trim(), id);
    }

    if (start_date !== undefined || end_date !== undefined) {
      const isHighPriorityMode = priorityMode === 'high';
      const startField = isHighPriorityMode ? 'high_priority_start_date' : 'start_date';
      const endField = isHighPriorityMode ? 'high_priority_end_date' : 'end_date';
      const currentProject = project as Record<string, unknown>;
      const sd = start_date !== undefined ? start_date : currentProject[startField] as string | null;
      const ed = end_date !== undefined ? end_date : currentProject[endField] as string | null;
      db.prepare(`UPDATE projects SET ${startField} = ?, ${endField} = ? WHERE id = ?`).run(sd, ed, id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update project error:', error);
    return NextResponse.json({ error: '更新项目失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!isManagerUser(user.username)) {
      return NextResponse.json({ error: '无删除权限' }, { status: 403 });
    }

    // Support ID from query param (primary) or request body (fallback)
    const { searchParams } = new URL(request.url);
    let id = Number(searchParams.get('id'));
    if (!id) {
      try {
        const body = await request.json();
        id = Number(body.id);
      } catch { /* body parse failed, use query param */ }
    }
    if (!id) return NextResponse.json({ error: '参数错误' }, { status: 400 });

    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as { id: number } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    // Get all case IDs for file cleanup
    const caseIds = db.prepare(`
      SELECT c.id FROM cases c 
      JOIN modules m ON c.module_id = m.id 
      JOIN projects p ON m.project_id = p.id 
      WHERE p.id = ?
    `).all(id) as { id: number }[];

    // Delete files from filesystem
    const { getStoragePath } = await import('@/lib/db');
    const storagePath = getStoragePath();
    for (const caseId of caseIds) {
      const files = db.prepare('SELECT storage_path FROM files WHERE case_id = ?').all(caseId.id) as { storage_path: string }[];
      for (const file of files) {
        try {
          const fs = await import('fs');
          const fullPath = file.storage_path;
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        } catch { /* ignore file delete errors */ }
      }
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete project error:', error);
    return NextResponse.json({ error: '删除项目失败' }, { status: 500 });
  }
}
