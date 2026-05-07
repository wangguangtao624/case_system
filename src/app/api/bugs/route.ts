import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

function getBugColumnNames() {
  const db = getDb();
  const columns = db.prepare(`PRAGMA table_info(bugs)`).all() as Array<{ name: string }>;
  return new Set(columns.map(column => column.name));
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // 'open', 'resolved', or null (all)

    const db = getDb();
    const bugColumns = getBugColumnNames();
    const resolverNameExpr = bugColumns.has('resolver_name')
      ? 'resolver_name'
      : bugColumns.has('resolved_by')
        ? 'resolved_by'
        : 'NULL';
    const resolveNoteExpr = bugColumns.has('resolve_note')
      ? 'resolve_note'
      : bugColumns.has('resolution_note')
        ? 'resolution_note'
        : "''";
    const resolverIdExpr = bugColumns.has('resolver_id') ? 'resolver_id' : 'NULL';

    let query = `
      SELECT
        id,
        title,
        description,
        reporter_id,
        reporter_name,
        status,
        ${resolverIdExpr} AS resolver_id,
        ${resolverNameExpr} AS resolver_name,
        ${resolveNoteExpr} AS resolve_note,
        resolved_at,
        created_at,
        updated_at
      FROM bugs
    `;
    if (status === 'open') {
      query += " WHERE status = 'open'";
    } else if (status === 'resolved') {
      query += " WHERE status = 'resolved'";
    }
    query += ' ORDER BY created_at DESC';

    const bugs = db.prepare(query).all();
    return NextResponse.json({ bugs, currentUserId: user.id, currentUsername: user.username });
  } catch (error) {
    console.error('Get bugs error:', error);
    return NextResponse.json({ error: '获取问题列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { title, description } = await request.json();
    if (!title || !title.trim()) {
      return NextResponse.json({ error: '标题不能为空' }, { status: 400 });
    }

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO bugs (title, description, reporter_id, reporter_name, status)
      VALUES (?, ?, ?, ?, 'open')
    `).run(title.trim(), description?.trim() || '', user.id, user.username);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create bug error:', error);
    return NextResponse.json({ error: '提交问题失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    if (user.username !== '王光涛') {
      return NextResponse.json({ error: '仅王光涛可以处理问题单' }, { status: 403 });
    }

    const { id, status: newStatus, resolveNote } = await request.json();
    if (!id) return NextResponse.json({ error: '缺少问题单ID' }, { status: 400 });

    const db = getDb();
    const bug = db.prepare('SELECT * FROM bugs WHERE id = ?').get(id);
    if (!bug) return NextResponse.json({ error: '问题单不存在' }, { status: 404 });
    const bugColumns = getBugColumnNames();
    const resolverNameColumn = bugColumns.has('resolver_name')
      ? 'resolver_name'
      : bugColumns.has('resolved_by')
        ? 'resolved_by'
        : null;
    const resolveNoteColumn = bugColumns.has('resolve_note')
      ? 'resolve_note'
      : bugColumns.has('resolution_note')
        ? 'resolution_note'
        : null;

    if (newStatus === 'resolved') {
      const updateFields = [`status = 'resolved'`, `resolved_at = datetime('now', 'localtime')`, `updated_at = datetime('now', 'localtime')`];
      const values: Array<number | string | null> = [];

      if (bugColumns.has('resolver_id')) {
        updateFields.push('resolver_id = ?');
        values.push(user.id);
      }

      if (resolverNameColumn) {
        updateFields.push(`${resolverNameColumn} = ?`);
        values.push(user.username);
      }

      if (resolveNoteColumn) {
        updateFields.push(`${resolveNoteColumn} = ?`);
        values.push(resolveNote || '');
      }

      values.push(id);
      db.prepare(`UPDATE bugs SET ${updateFields.join(', ')} WHERE id = ?`).run(...values);
    } else if (newStatus === 'open') {
      const updateFields = [`status = 'open'`, `resolved_at = NULL`, `updated_at = datetime('now', 'localtime')`];

      if (bugColumns.has('resolver_id')) {
        updateFields.push('resolver_id = NULL');
      }

      if (resolverNameColumn) {
        updateFields.push(`${resolverNameColumn} = NULL`);
      }

      if (resolveNoteColumn) {
        updateFields.push(`${resolveNoteColumn} = ''`);
      }

      db.prepare(`UPDATE bugs SET ${updateFields.join(', ')} WHERE id = ?`).run(id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update bug error:', error);
    return NextResponse.json({ error: '处理问题单失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    if (user.username !== '王光涛') {
      return NextResponse.json({ error: '仅王光涛可以删除问题单' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!id) return NextResponse.json({ error: '参数错误' }, { status: 400 });

    const db = getDb();
    db.prepare('DELETE FROM bugs WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete bug error:', error);
    return NextResponse.json({ error: '删除问题单失败' }, { status: 500 });
  }
}
