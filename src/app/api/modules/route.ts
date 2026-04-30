import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

    const db = getDb();
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(Number(projectId));
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const modules = db.prepare('SELECT * FROM modules WHERE project_id = ? ORDER BY sort_order, id').all(Number(projectId));
    return NextResponse.json({ modules });
  } catch (error) {
    console.error('Get modules error:', error);
    return NextResponse.json({ error: '获取模块列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!MANAGER_USERNAMES.includes(user.username)) {
      return NextResponse.json({ error: '无创建权限' }, { status: 403 });
    }

    const { projectId, name } = await request.json();
    if (!projectId || !name || !name.trim()) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const db = getDb();
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM modules WHERE project_id = ?').get(projectId) as { m: number | null };
    const result = db.prepare('INSERT INTO modules (project_id, name, sort_order) VALUES (?, ?, ?)').run(projectId, name.trim(), (maxOrder.m || 0) + 1);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create module error:', error);
    return NextResponse.json({ error: '创建模块失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!MANAGER_USERNAMES.includes(user.username)) {
      return NextResponse.json({ error: '无修改权限' }, { status: 403 });
    }

    const { id, name } = await request.json();
    if (!id || !name || !name.trim()) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const db = getDb();
    const moduleRow = db.prepare('SELECT project_id FROM modules WHERE id = ?').get(id) as { project_id: number } | undefined;
    if (!moduleRow) return NextResponse.json({ error: '模块不存在' }, { status: 404 });

    db.prepare('UPDATE modules SET name = ? WHERE id = ?').run(name.trim(), id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update module error:', error);
    return NextResponse.json({ error: '更新模块失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!MANAGER_USERNAMES.includes(user.username)) {
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

    const moduleRow = db.prepare('SELECT project_id FROM modules WHERE id = ?').get(id) as { project_id: number } | undefined;
    if (!moduleRow) return NextResponse.json({ error: '模块不存在' }, { status: 404 });

    // Get all case IDs for file cleanup
    const caseIds = db.prepare('SELECT id FROM cases WHERE module_id = ?').all(id) as { id: number }[];

    const { getStoragePath } = await import('@/lib/db');
    for (const caseId of caseIds) {
      const files = db.prepare('SELECT storage_path FROM files WHERE case_id = ?').all(caseId.id) as { storage_path: string }[];
      for (const file of files) {
        try {
          const fs = await import('fs');
          if (fs.existsSync(file.storage_path)) fs.unlinkSync(file.storage_path);
        } catch { /* ignore */ }
      }
    }

    db.prepare('DELETE FROM modules WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete module error:', error);
    return NextResponse.json({ error: '删除模块失败' }, { status: 500 });
  }
}
