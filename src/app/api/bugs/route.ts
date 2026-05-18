import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';

const BUG_FIXER_USERNAME = '王光涛';

type BugRow = {
  id: number;
  title: string;
  description: string;
  reporter_id: number;
  reporter_name: string;
  workflow_status: string | null;
  current_handler_id: number | null;
  current_handler_name: string | null;
  current_round: number | null;
  resolver_id: number | null;
  resolver_name: string | null;
  resolve_note: string;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

type BugStepLog = {
  id: number;
  bug_id: number;
  step_type: string;
  action_type: string;
  round: number;
  actor_id: number | null;
  actor_name: string;
  content: string;
  created_at: string;
};

function getBugColumnNames() {
  const db = getDb();
  const columns = db.prepare(`PRAGMA table_info(bugs)`).all() as Array<{ name: string }>;
  return new Set(columns.map(column => column.name));
}

function normalizeWorkflowStatus(status?: string | null) {
  if (status === 'closed' || status === 'regression' || status === 'processing') return status;
  if (status === 'resolved') return 'closed';
  return 'processing';
}

function getBugById(id: number) {
  const db = getDb();
  const columns = getBugColumnNames();
  const workflowStatusExpr = columns.has('workflow_status')
    ? 'workflow_status'
    : "CASE WHEN status = 'resolved' THEN 'closed' ELSE 'processing' END";
  const currentHandlerIdExpr = columns.has('current_handler_id') ? 'current_handler_id' : 'NULL';
  const currentHandlerNameExpr = columns.has('current_handler_name')
    ? 'current_handler_name'
    : `CASE WHEN status = 'resolved' THEN NULL ELSE '${BUG_FIXER_USERNAME}' END`;
  const currentRoundExpr = columns.has('current_round') ? 'current_round' : '1';
  const closedAtExpr = columns.has('closed_at') ? 'closed_at' : 'NULL';
  const resolverNameExpr = columns.has('resolver_name')
    ? 'resolver_name'
    : columns.has('resolved_by')
      ? 'resolved_by'
      : 'NULL';
  const resolveNoteExpr = columns.has('resolve_note')
    ? 'resolve_note'
    : columns.has('resolution_note')
      ? 'resolution_note'
      : "''";
  const resolverIdExpr = columns.has('resolver_id') ? 'resolver_id' : 'NULL';

  const row = db.prepare(`
    SELECT
      id,
      title,
      description,
      reporter_id,
      reporter_name,
      ${workflowStatusExpr} AS workflow_status,
      ${currentHandlerIdExpr} AS current_handler_id,
      ${currentHandlerNameExpr} AS current_handler_name,
      ${currentRoundExpr} AS current_round,
      ${resolverIdExpr} AS resolver_id,
      ${resolverNameExpr} AS resolver_name,
      ${resolveNoteExpr} AS resolve_note,
      resolved_at,
      ${closedAtExpr} AS closed_at,
      created_at,
      updated_at
    FROM bugs
    WHERE id = ?
  `).get(id) as BugRow | undefined;

  return row
    ? {
        ...row,
        workflow_status: normalizeWorkflowStatus(row.workflow_status),
        current_round: row.current_round && row.current_round > 0 ? row.current_round : 1,
      }
    : null;
}

function appendBugStepLog(params: {
  bugId: number;
  stepType: 'submit' | 'process' | 'regression' | 'close';
  actionType: string;
  round: number;
  actorId: number | null;
  actorName: string;
  content: string;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO bug_step_logs (bug_id, step_type, action_type, round, actor_id, actor_name, content)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.bugId,
    params.stepType,
    params.actionType,
    params.round,
    params.actorId,
    params.actorName,
    params.content || ''
  );
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('status');
    const badgeOnly = searchParams.get('badge') === '1';
    const db = getDb();
    const columns = getBugColumnNames();
    const workflowStatusExpr = columns.has('workflow_status')
      ? 'workflow_status'
      : "CASE WHEN status = 'resolved' THEN 'closed' ELSE 'processing' END";
    const currentHandlerIdExpr = columns.has('current_handler_id') ? 'current_handler_id' : 'NULL';
    const currentHandlerNameExpr = columns.has('current_handler_name')
      ? 'current_handler_name'
      : `CASE WHEN status = 'resolved' THEN NULL ELSE '${BUG_FIXER_USERNAME}' END`;
    const currentRoundExpr = columns.has('current_round') ? 'current_round' : '1';
    const closedAtExpr = columns.has('closed_at') ? 'closed_at' : 'NULL';
    const resolverNameExpr = columns.has('resolver_name')
      ? 'resolver_name'
      : columns.has('resolved_by')
        ? 'resolved_by'
        : 'NULL';
    const resolveNoteExpr = columns.has('resolve_note')
      ? 'resolve_note'
      : columns.has('resolution_note')
        ? 'resolution_note'
        : "''";
    const resolverIdExpr = columns.has('resolver_id') ? 'resolver_id' : 'NULL';

    let query = `
      SELECT
        id,
        title,
        description,
        reporter_id,
        reporter_name,
        ${workflowStatusExpr} AS workflow_status,
        ${currentHandlerIdExpr} AS current_handler_id,
        ${currentHandlerNameExpr} AS current_handler_name,
        ${currentRoundExpr} AS current_round,
        ${resolverIdExpr} AS resolver_id,
        ${resolverNameExpr} AS resolver_name,
        ${resolveNoteExpr} AS resolve_note,
        resolved_at,
        ${closedAtExpr} AS closed_at,
        created_at,
        updated_at
      FROM bugs
    `;

    if (filter === 'closed') {
      query += ` WHERE ${workflowStatusExpr} = 'closed' OR status = 'resolved'`;
    } else if (filter === 'processing') {
      query += ` WHERE ${workflowStatusExpr} = 'processing'`;
    } else if (filter === 'regression') {
      query += ` WHERE ${workflowStatusExpr} = 'regression'`;
    } else if (filter === 'mine') {
      query += ` WHERE (${currentHandlerNameExpr} = @username) OR reporter_name = @username`;
    }

    if (badgeOnly) {
      const countQuery = `
        SELECT COUNT(*) as count
        FROM bugs
        WHERE ${workflowStatusExpr} != 'closed'
          AND ${currentHandlerNameExpr} = @username
      `;
      const result = db.prepare(countQuery).get({ username: user.username }) as { count: number };
      return NextResponse.json({ count: result?.count || 0, currentUsername: user.username, fixerUsername: BUG_FIXER_USERNAME });
    }

    query += ' ORDER BY CASE WHEN workflow_status = \'closed\' THEN 1 ELSE 0 END, updated_at DESC, created_at DESC';

    const bugs = db.prepare(query).all({ username: user.username }) as BugRow[];
    const bugIds = bugs.map(bug => bug.id);
    const logs = bugIds.length > 0
      ? db.prepare(`
          SELECT id, bug_id, step_type, action_type, round, actor_id, actor_name, content, created_at
          FROM bug_step_logs
          WHERE bug_id IN (${bugIds.map(() => '?').join(', ')})
          ORDER BY created_at ASC, id ASC
        `).all(...bugIds) as BugStepLog[]
      : [];

    const logsByBugId = logs.reduce<Record<number, BugStepLog[]>>((acc, log) => {
      if (!acc[log.bug_id]) acc[log.bug_id] = [];
      acc[log.bug_id].push(log);
      return acc;
    }, {});

    return NextResponse.json({
      bugs: bugs.map(bug => ({
        ...bug,
        workflow_status: normalizeWorkflowStatus(bug.workflow_status),
        current_round: bug.current_round && bug.current_round > 0 ? bug.current_round : 1,
        step_logs: logsByBugId[bug.id] || [],
      })),
      currentUserId: user.id,
      currentUsername: user.username,
      fixerUsername: BUG_FIXER_USERNAME,
      isManager: isManagerUser(user.username),
    });
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
      INSERT INTO bugs (
        title,
        description,
        reporter_id,
        reporter_name,
        status,
        workflow_status,
        current_handler_id,
        current_handler_name,
        current_round
      )
      VALUES (?, ?, ?, ?, 'open', 'processing', NULL, ?, 1)
    `).run(
      title.trim(),
      description?.trim() || '',
      user.id,
      user.username,
      BUG_FIXER_USERNAME
    );

    const bugId = Number(result.lastInsertRowid);
    appendBugStepLog({
      bugId,
      stepType: 'submit',
      actionType: 'submitted',
      round: 1,
      actorId: user.id,
      actorName: user.username,
      content: description?.trim() || '',
    });

    return NextResponse.json({ success: true, id: bugId });
  } catch (error) {
    console.error('Create bug error:', error);
    return NextResponse.json({ error: '提交问题失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { id, action, content } = await request.json();
    const bugId = Number(id);
    if (!bugId || !action) return NextResponse.json({ error: '参数不完整' }, { status: 400 });

    const db = getDb();
    const bug = getBugById(bugId);
    if (!bug) return NextResponse.json({ error: '问题单不存在' }, { status: 404 });

    const round = bug.current_round || 1;

    if (action === 'process') {
      if (user.username !== BUG_FIXER_USERNAME) {
        return NextResponse.json({ error: `仅 ${BUG_FIXER_USERNAME} 可以处理问题单` }, { status: 403 });
      }
      if (bug.workflow_status !== 'processing') {
        return NextResponse.json({ error: '当前问题单不在处理环节' }, { status: 400 });
      }

      db.prepare(`
        UPDATE bugs
        SET
          workflow_status = 'regression',
          current_handler_id = reporter_id,
          current_handler_name = reporter_name,
          resolver_id = ?,
          resolver_name = ?,
          resolve_note = ?,
          resolved_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(user.id, user.username, content || '', bugId);

      appendBugStepLog({
        bugId,
        stepType: 'process',
        actionType: 'processed',
        round,
        actorId: user.id,
        actorName: user.username,
        content: content || '',
      });
    } else if (action === 'regression_pass') {
      if (user.id !== bug.reporter_id) {
        return NextResponse.json({ error: '仅提单人本人可以执行回归' }, { status: 403 });
      }
      if (bug.workflow_status !== 'regression') {
        return NextResponse.json({ error: '当前问题单不在回归环节' }, { status: 400 });
      }

      db.prepare(`
        UPDATE bugs
        SET
          workflow_status = 'closed',
          status = 'resolved',
          current_handler_id = NULL,
          current_handler_name = NULL,
          closed_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(bugId);

      appendBugStepLog({
        bugId,
        stepType: 'regression',
        actionType: 'passed',
        round,
        actorId: user.id,
        actorName: user.username,
        content: content || '',
      });

      appendBugStepLog({
        bugId,
        stepType: 'close',
        actionType: 'closed',
        round,
        actorId: user.id,
        actorName: user.username,
        content: content || '',
      });
    } else if (action === 'regression_fail') {
      if (user.id !== bug.reporter_id) {
        return NextResponse.json({ error: '仅提单人本人可以执行回归' }, { status: 403 });
      }
      if (bug.workflow_status !== 'regression') {
        return NextResponse.json({ error: '当前问题单不在回归环节' }, { status: 400 });
      }

      db.prepare(`
        UPDATE bugs
        SET
          workflow_status = 'processing',
          status = 'open',
          current_handler_id = NULL,
          current_handler_name = ?,
          current_round = current_round + 1,
          closed_at = NULL,
          updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(BUG_FIXER_USERNAME, bugId);

      appendBugStepLog({
        bugId,
        stepType: 'regression',
        actionType: 'failed',
        round,
        actorId: user.id,
        actorName: user.username,
        content: content || '',
      });
    } else {
      return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
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
    if (!(user.username === BUG_FIXER_USERNAME || isManagerUser(user.username))) {
      return NextResponse.json({ error: '仅管理员或王光涛可以删除问题单' }, { status: 403 });
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
