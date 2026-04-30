import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

function isManager(username: string): boolean {
  return MANAGER_USERNAMES.includes(username);
}

// GET: list assignments, optionally filtered by level/target or user
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level');
    const targetId = searchParams.get('targetId');
    const userId = searchParams.get('userId');

    const db = getDb();

    let query = `
      SELECT a.*, u.username as tester_name
      FROM assignments a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (level) {
      query += ' AND a.level = ?';
      params.push(level);
    }
    if (targetId) {
      query += ' AND a.target_id = ?';
      params.push(Number(targetId));
    }
    if (userId) {
      query += ' AND a.user_id = ?';
      params.push(Number(userId));
    }

    query += ' ORDER BY a.level, a.target_id';

    const assignments = db.prepare(query).all(...params);
    return NextResponse.json({ assignments });
  } catch (error) {
    console.error('Get assignments error:', error);
    return NextResponse.json({ error: '获取分配信息失败' }, { status: 500 });
  }
}

// POST: create or update an assignment
// When assigning at project/module level, cascade to all child cases (last assignment wins)
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    if (!isManager(user.username)) {
      return NextResponse.json({ error: '无分配权限' }, { status: 403 });
    }

    const { level, targetId, userId } = await request.json();
    if (!level || !targetId || !userId) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    if (!['project', 'module', 'case'].includes(level)) {
      return NextResponse.json({ error: '无效的分配层级' }, { status: 400 });
    }

    const db = getDb();

    // Verify target exists
    const tableMap: Record<string, string> = { project: 'projects', module: 'modules', case: 'cases' };
    const target = db.prepare(`SELECT id FROM ${tableMap[level]} WHERE id = ?`).get(Number(targetId));
    if (!target) return NextResponse.json({ error: '目标不存在' }, { status: 404 });

    // Verify user exists
    const assignUser = db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(userId)) as { id: number; username: string } | undefined;
    if (!assignUser) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

    const numUserId = Number(userId);
    const numTargetId = Number(targetId);

    if (level === 'project') {
      // Project-level assignment: cascade to ALL cases in the project
      // 1. Delete all existing case-level and module-level assignments under this project
      const moduleIds = db.prepare('SELECT id FROM modules WHERE project_id = ?').all(numTargetId) as { id: number }[];
      const moduleIdList = moduleIds.map(m => m.id);

      // Delete module-level assignments
      if (moduleIdList.length > 0) {
        const placeholders = moduleIdList.map(() => '?').join(',');
        db.prepare(`DELETE FROM assignments WHERE level = 'module' AND target_id IN (${placeholders})`).run(...moduleIdList);
      }

      // Delete case-level assignments for all cases in the project
      const caseIds = db.prepare(`
        SELECT c.id FROM cases c
        JOIN modules m ON c.module_id = m.id
        WHERE m.project_id = ?
      `).all(numTargetId) as { id: number }[];
      const caseIdList = caseIds.map(c => c.id);

      if (caseIdList.length > 0) {
        const placeholders = caseIdList.map(() => '?').join(',');
        db.prepare(`DELETE FROM assignments WHERE level = 'case' AND target_id IN (${placeholders})`).run(...caseIdList);

        // 2. Create case-level assignments for ALL cases in the project
        const insertStmt = db.prepare('INSERT INTO assignments (level, target_id, user_id) VALUES (?, ?, ?)');
        const insertMany = db.transaction((ids: number[]) => {
          for (const cid of ids) {
            insertStmt.run('case', cid, numUserId);
          }
        });
        insertMany(caseIdList);
      }

      // 3. Upsert project-level assignment
      const existing = db.prepare('SELECT id FROM assignments WHERE level = ? AND target_id = ?').get(level, numTargetId) as { id: number } | undefined;
      if (existing) {
        db.prepare('UPDATE assignments SET user_id = ? WHERE id = ?').run(numUserId, existing.id);
      } else {
        db.prepare('INSERT INTO assignments (level, target_id, user_id) VALUES (?, ?, ?)').run(level, numTargetId, numUserId);
      }
    } else if (level === 'module') {
      // Module-level assignment: cascade to ALL cases in the module
      // 1. Delete all existing case-level assignments under this module
      const caseIds = db.prepare('SELECT id FROM cases WHERE module_id = ?').all(numTargetId) as { id: number }[];
      const caseIdList = caseIds.map(c => c.id);

      if (caseIdList.length > 0) {
        const placeholders = caseIdList.map(() => '?').join(',');
        db.prepare(`DELETE FROM assignments WHERE level = 'case' AND target_id IN (${placeholders})`).run(...caseIdList);

        // 2. Create case-level assignments for ALL cases in the module
        const insertStmt = db.prepare('INSERT INTO assignments (level, target_id, user_id) VALUES (?, ?, ?)');
        const insertMany = db.transaction((ids: number[]) => {
          for (const cid of ids) {
            insertStmt.run('case', cid, numUserId);
          }
        });
        insertMany(caseIdList);
      }

      // 3. Upsert module-level assignment
      const existing = db.prepare('SELECT id FROM assignments WHERE level = ? AND target_id = ?').get(level, numTargetId) as { id: number } | undefined;
      if (existing) {
        db.prepare('UPDATE assignments SET user_id = ? WHERE id = ?').run(numUserId, existing.id);
      } else {
        db.prepare('INSERT INTO assignments (level, target_id, user_id) VALUES (?, ?, ?)').run(level, numTargetId, numUserId);
      }
    } else {
      // Case-level assignment: simple upsert
      const existing = db.prepare('SELECT id FROM assignments WHERE level = ? AND target_id = ?').get(level, numTargetId) as { id: number } | undefined;
      if (existing) {
        db.prepare('UPDATE assignments SET user_id = ? WHERE id = ?').run(numUserId, existing.id);
      } else {
        db.prepare('INSERT INTO assignments (level, target_id, user_id) VALUES (?, ?, ?)').run(level, numTargetId, numUserId);
      }
    }

    return NextResponse.json({ success: true, testerName: assignUser.username });
  } catch (error) {
    console.error('Create assignment error:', error);
    return NextResponse.json({ error: '分配失败' }, { status: 500 });
  }
}

// DELETE: remove an assignment
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    if (!isManager(user.username)) {
      return NextResponse.json({ error: '无分配权限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    const level = searchParams.get('level');
    const targetId = searchParams.get('targetId');

    const db = getDb();

    if (id) {
      db.prepare('DELETE FROM assignments WHERE id = ?').run(id);
    } else if (level && targetId) {
      db.prepare('DELETE FROM assignments WHERE level = ? AND target_id = ?').run(level, Number(targetId));
    } else {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete assignment error:', error);
    return NextResponse.json({ error: '取消分配失败' }, { status: 500 });
  }
}
