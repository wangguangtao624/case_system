import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCurrentUser, isManagerUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { builtinScriptPath } from '@/lib/automation';

/** 用例底层执行代码：查看 / 覆盖。
 *
 * GET  /api/automation/code?caseId=N  任何登录用户可看
 * PUT  /api/automation/code            { caseId, source }  仅 manager 或该用例的执行人
 *
 * 没有覆盖记录时返回 automation/cases/<automation_key>.py 的内置内容。
 */
function isCaseTester(db: ReturnType<typeof getDb>, caseId: number, userId: number): boolean {
  const tester = db.prepare(`
    SELECT COALESCE(ca.user_id, ma.user_id, pa.user_id) AS tester_id
    FROM cases c
    JOIN modules m ON m.id = c.module_id
    JOIN projects p ON p.id = m.project_id
    LEFT JOIN assignments ca ON ca.level = 'case' AND ca.target_id = c.id
    LEFT JOIN assignments ma ON ma.level = 'module' AND ma.target_id = c.module_id
    LEFT JOIN assignments pa ON pa.level = 'project' AND pa.target_id = c.project_id
    WHERE c.id = ?
  `).get(caseId) as { tester_id: number | null } | undefined;
  return tester?.tester_id === userId;
}

function loadCase(db: ReturnType<typeof getDb>, caseId: number) {
  return db.prepare(`SELECT c.id, c.case_no, c.case_name, c.automation_key
                     FROM cases c
                     JOIN modules m ON m.id = c.module_id
                     JOIN projects p ON p.id = m.project_id
                     WHERE c.id = ?`).get(caseId) as
    { id: number; case_no: string; case_name: string; automation_key: string } | undefined;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const caseId = Number(new URL(request.url).searchParams.get('caseId'));
    if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: '缺少用例 ID' }, { status: 400 });

    const db = getDb();
    const caseRow = loadCase(db, caseId);
    if (!caseRow) return NextResponse.json({ error: '用例不存在' }, { status: 404 });
    if (!caseRow.automation_key) {
      return NextResponse.json({
        success: true,
        case: caseRow,
        automationKey: '',
        source: '',
        overridden: false,
        builtinPath: '',
        updatedAt: '',
        canEdit: false,
        note: '该用例尚未绑定自动化执行代码',
      });
    }

    const stored = db.prepare(`SELECT source, updated_at FROM automation_case_codes WHERE case_id=? AND automation_key=?`)
      .get(caseId, caseRow.automation_key) as { source: string; updated_at: string } | undefined;
    const builtin = builtinScriptPath(caseRow.automation_key);
    const builtinText = fs.existsSync(builtin) ? fs.readFileSync(builtin, 'utf-8') : '';

    return NextResponse.json({
      success: true,
      case: caseRow,
      automationKey: caseRow.automation_key,
      source: stored?.source?.trim() ? stored.source : builtinText,
      overridden: Boolean(stored?.source?.trim()),
      builtinPath: builtin.replace(/\\/g, '/'),
      updatedAt: stored?.updated_at || '',
      canEdit: isManagerUser(user.username) || isCaseTester(db, caseId, user.id),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取用例代码失败' }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const body = await request.json() as { caseId?: number; source?: string };
    const caseId = Number(body.caseId);
    if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: '缺少用例 ID' }, { status: 400 });
    if (typeof body.source !== 'string' || !body.source.trim()) {
      return NextResponse.json({ error: '代码内容不能为空' }, { status: 400 });
    }
    if (body.source.length > 20000) return NextResponse.json({ error: '代码过长' }, { status: 400 });

    const db = getDb();
    const caseRow = loadCase(db, caseId);
    if (!caseRow) return NextResponse.json({ error: '用例不存在' }, { status: 404 });
    if (!caseRow.automation_key) return NextResponse.json({ error: '该用例尚未绑定自动化执行代码' }, { status: 400 });
    if (!isManagerUser(user.username) && !isCaseTester(db, caseId, user.id)) {
      return NextResponse.json({ error: '只有管理员或该用例的执行人可以修改执行代码' }, { status: 403 });
    }

    // 保存前先做语法检查，避免把跑不起来的代码写进去。
    const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
    const probe = path.join(workspace, 'automation', 'syntax_check.py');
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, body.source, 'utf-8');
    try {
      const { execFileSync } = await import('child_process');
      execFileSync('py', ['-3.12', '-c', `import py_compile; py_compile.compile(r"${probe}", doraise=True)`], {
        cwd: workspace, windowsHide: true, stdio: 'pipe', encoding: 'utf-8',
      });
    } catch (error) {
      const detail = error instanceof Error
        ? String((error as { stderr?: unknown }).stderr ?? error.message).trim()
        : '语法检查失败';
      return NextResponse.json({ error: `代码语法检查未通过：${detail.split('\n').slice(-3).join(' | ')}` }, { status: 400 });
    }

    db.prepare(`INSERT INTO automation_case_codes(case_id, automation_key, source, updated_at)
                VALUES(?,?,?,datetime('now','localtime'))
                ON CONFLICT(case_id) DO UPDATE SET source=excluded.source, updated_at=excluded.updated_at`)
      .run(caseId, caseRow.automation_key, body.source);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '保存用例代码失败' }, { status: 400 });
  }
}

/** 删掉用例级覆盖，回到 automation/cases/ 的内置脚本。 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const caseId = Number(new URL(request.url).searchParams.get('caseId'));
    if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: '缺少用例 ID' }, { status: 400 });

    const db = getDb();
    const caseRow = loadCase(db, caseId);
    if (!caseRow) return NextResponse.json({ error: '用例不存在' }, { status: 404 });
    if (!caseRow.automation_key) return NextResponse.json({ error: '该用例尚未绑定自动化执行代码' }, { status: 400 });
    if (!isManagerUser(user.username) && !isCaseTester(db, caseId, user.id)) {
      return NextResponse.json({ error: '只有管理员或该用例的执行人可以修改执行代码' }, { status: 403 });
    }

    const result = db.prepare(`DELETE FROM automation_case_codes WHERE case_id=? AND automation_key=?`)
      .run(caseId, caseRow.automation_key);
    return NextResponse.json({ success: true, removed: Number(result.changes) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '恢复默认代码失败' }, { status: 400 });
  }
}
