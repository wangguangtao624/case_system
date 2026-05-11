import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

function isManager(username: string): boolean {
  return MANAGER_USERNAMES.includes(username);
}

// Helper: check if module exists
function moduleExists(db: ReturnType<typeof import('@/lib/db').getDb>, moduleId: number): boolean {
  const row = db.prepare('SELECT id FROM modules WHERE id = ?').get(moduleId);
  return !!row;
}

// Helper: resolve the tester for a case (case > module > project assignment)
function resolveCaseTester(db: ReturnType<typeof import('@/lib/db').getDb>, caseId: number): { userId: number; username: string } | null {
  const result = db.prepare(`
    SELECT c.id,
      COALESCE(ca.user_id, ma.user_id, pa.user_id) as resolved_user_id,
      COALESCE(ca_u.username, ma_u.username, pa_u.username) as resolved_username
    FROM cases c
    JOIN modules m ON c.module_id = m.id
    JOIN projects p ON m.project_id = p.id
    LEFT JOIN assignments ca ON ca.level = 'case' AND ca.target_id = c.id
    LEFT JOIN users ca_u ON ca.user_id = ca_u.id
    LEFT JOIN assignments ma ON ma.level = 'module' AND ma.target_id = c.module_id
    LEFT JOIN users ma_u ON ma.user_id = ma_u.id
    LEFT JOIN assignments pa ON pa.level = 'project' AND pa.target_id = p.id
    LEFT JOIN users pa_u ON pa.user_id = pa_u.id
    WHERE c.id = ?
  `).get(caseId) as { id: number; resolved_user_id: number | null; resolved_username: string | null } | undefined;

  if (result?.resolved_user_id && result?.resolved_username) {
    return { userId: result.resolved_user_id, username: result.resolved_username };
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const moduleId = searchParams.get('moduleId');
    if (!moduleId) return NextResponse.json({ error: '缺少模块ID' }, { status: 400 });

    const db = getDb();
    const cases = db.prepare(`
      SELECT c.* FROM cases c
      JOIN modules m ON c.module_id = m.id
      WHERE c.module_id = ?
      ORDER BY c.sort_order, c.id
    `).all(Number(moduleId));

    return NextResponse.json({ cases });
  } catch (error) {
    console.error('Get cases error:', error);
    return NextResponse.json({ error: '获取用例列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    // Only managers can create cases
    if (!isManager(user.username)) {
      return NextResponse.json({ error: '无创建权限' }, { status: 403 });
    }

    const { moduleId, caseNo } = await request.json();
    if (!moduleId) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const db = getDb();
    if (!moduleExists(db, moduleId)) {
      return NextResponse.json({ error: '模块不存在' }, { status: 404 });
    }

    const caseNoValue = caseNo?.trim() || '';
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM cases WHERE module_id = ?').get(moduleId) as { m: number | null };
    const result = db.prepare(`
      INSERT INTO cases (module_id, case_name, case_no, sort_order) VALUES (?, ?, ?, ?)
    `).run(moduleId, caseNoValue ? '' : '新用例', caseNoValue, (maxOrder.m || 0) + 1);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create case error:', error);
    return NextResponse.json({ error: '创建用例失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const data = await request.json();
    const { id, saveType } = data; // saveType: 'core' | 'result'

    if (!id) return NextResponse.json({ error: '缺少用例ID' }, { status: 400 });

    const db = getDb();
    const caseRow = db.prepare('SELECT module_id FROM cases WHERE id = ?').get(id) as { module_id: number } | undefined;
    if (!caseRow) return NextResponse.json({ error: '用例不存在' }, { status: 404 });

    if (!moduleExists(db, caseRow.module_id)) {
      return NextResponse.json({ error: '模块不存在' }, { status: 404 });
    }

    const archivedRow = db.prepare(`
      SELECT p.is_archived FROM projects p
      JOIN modules m ON m.project_id = p.id
      WHERE m.id = ?
    `).get(caseRow.module_id) as { is_archived: number } | undefined;
    const isArchived = archivedRow?.is_archived === 1;

    const manager = isManager(user.username);

    if (manager) {
      // Manager: can edit all fields
      const { case_name, priority, test_env, test_device, pre_operation, step, expect_result, note, test_result, jira_link, fail_note, test_log, case_no, test_category, feature, trait, test_result_note, light, temperature } = data;

      if (saveType === 'core') {
        db.prepare(`
          UPDATE cases SET 
            case_name = ?, priority = ?, test_env = ?, pre_operation = ?,
            step = ?, expect_result = ?, note = ?,
            case_no = ?, test_category = ?, feature = ?, trait = ?,
            light = ?, temperature = ?,
            updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(case_name, priority, test_env || '', pre_operation, step, expect_result, note, case_no || '', test_category || '', feature || '', trait || '', light || '', temperature || '', id);
      } else if (saveType === 'rename') {
        // Rename only - update both case_no and case_name, preserve all other fields
        const caseNoValue = data.case_no !== undefined ? data.case_no : undefined;
        if (caseNoValue !== undefined) {
          db.prepare(`
            UPDATE cases SET 
              case_name = ?, case_no = ?,
              updated_at = datetime('now', 'localtime')
            WHERE id = ?
          `).run(case_name, caseNoValue || '', id);
        } else {
          db.prepare(`
            UPDATE cases SET 
              case_name = ?,
              updated_at = datetime('now', 'localtime')
            WHERE id = ?
          `).run(case_name, id);
        }
      } else {
        // save result fields
        db.prepare(`
          UPDATE cases SET 
            test_device = ?, test_result = ?, jira_link = ?, fail_note = ?, test_log = ?,
            test_result_note = ?,
            executor = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(test_device || '', test_result, jira_link, fail_note || '', test_log || '', test_result_note || '', user.username, id);
      }
    } else {
      // Tester: can only edit specific fields on assigned cases
      if (isArchived) {
        return NextResponse.json({ error: '归档项目不允许修改测试结果' }, { status: 403 });
      }
      const tester = resolveCaseTester(db, id);
      if (!tester || tester.userId !== user.id) {
        return NextResponse.json({ error: '无编辑权限，该用例未分配给你' }, { status: 403 });
      }

      // Only allow tester-editable fields
      const { test_device, test_result, jira_link, fail_note, test_log, test_result_note } = data;

      db.prepare(`
        UPDATE cases SET 
          test_device = ?, test_result = ?, jira_link = ?, fail_note = ?, test_log = ?,
          test_result_note = ?,
          executor = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(test_device || '', test_result, jira_link, fail_note || '', test_log || '', test_result_note || '', user.username, id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update case error:', error);
    return NextResponse.json({ error: '更新用例失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    // Only managers can delete cases
    if (!isManager(user.username)) {
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

    const caseRow = db.prepare('SELECT module_id FROM cases WHERE id = ?').get(id) as { module_id: number } | undefined;
    if (!caseRow) return NextResponse.json({ error: '用例不存在' }, { status: 404 });

    if (!moduleExists(db, caseRow.module_id)) {
      return NextResponse.json({ error: '模块不存在' }, { status: 404 });
    }

    // Delete files from filesystem
    const files = db.prepare('SELECT storage_path FROM files WHERE case_id = ?').all(id) as { storage_path: string }[];
    for (const file of files) {
      try {
        const fs = await import('fs');
        if (fs.existsSync(file.storage_path)) fs.unlinkSync(file.storage_path);
      } catch { /* ignore */ }
    }

    // Delete case-level assignments
    db.prepare('DELETE FROM assignments WHERE level = ? AND target_id = ?').run('case', id);

    db.prepare('DELETE FROM cases WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete case error:', error);
    return NextResponse.json({ error: '删除用例失败' }, { status: 500 });
  }
}
