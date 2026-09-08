import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

type CaseResultRow = {
  id: number;
  run_id: string;
  status: string;
  log: string;
  screenshot_path: string;
  raw_screenshot_path: string;
  frame_id: string;
  readings: string;
  image_file_id: number | null;
  raw_file_id: number | null;
  finished_at: string | null;
};

type RunRow = {
  id: string;
  mode: string;
  status: string;
  error: string;
  log: string;
  created_at: string;
  finished_at: string | null;
  ini_path: string;
  bin_path: string;
  requested_by: number;
};

/** 单个用例的自动化执行历史：给界面上的自动化控件用。
 *  GET /api/automation/case-runs/:caseId
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const { caseId } = await params;
    const caseIdNum = Number(caseId);
    if (!Number.isInteger(caseIdNum) || caseIdNum <= 0) {
      return NextResponse.json({ error: '用例 ID 无效' }, { status: 400 });
    }

    const db = getDb();
    const caseRow = db.prepare(`SELECT c.id,c.case_no,c.case_name,c.automation_key,c.test_result
                                FROM cases c JOIN modules m ON m.id=c.module_id JOIN projects p ON p.id=m.project_id
                                WHERE c.id=?`).get(caseIdNum) as {
      id: number; case_no: string; case_name: string; automation_key: string; test_result: string | null;
    } | undefined;
    if (!caseRow) return NextResponse.json({ error: '用例不存在' }, { status: 404 });

    const results = db.prepare(`SELECT * FROM automation_case_results WHERE case_id=? ORDER BY id DESC`).all(caseIdNum) as CaseResultRow[];
    const runIds = [...new Set(results.map(r => r.run_id))];
    let runs: RunRow[] = [];
    if (runIds.length) {
      // 老库列名是 started_at，新库是 created_at，按实际存在的列读。
      const columns = new Set(db.prepare('PRAGMA table_info(automation_runs)').all()
        .map(c => String((c as { name: unknown }).name)));
      const startedColumn = columns.has('created_at') ? 'created_at' : columns.has('started_at') ? 'started_at' : 'started_at';
      const marks = runIds.map(() => '?').join(',');
      runs = db.prepare(`SELECT *, COALESCE(${startedColumn},'') AS created_at FROM automation_runs WHERE id IN (${marks}) ORDER BY ${startedColumn} DESC`)
        .all(...runIds) as RunRow[];
    }
    const runById = new Map(runs.map(run => [run.id, run]));

    return NextResponse.json({
      case: caseRow,
      entries: results
        .filter(result => runById.has(result.run_id))
        .map(result => ({
          id: result.id,
          status: result.status,
          log: result.log || '',
          readings: result.readings || '',
          frameId: result.frame_id || '',
          finishedAt: result.finished_at || '',
          previewUrl: result.image_file_id ? `/api/files/preview/${result.image_file_id}` : '',
          rawDownloadUrl: result.raw_file_id ? `/api/files/${result.raw_file_id}?download=1` : '',
          rawName: result.raw_screenshot_path ? result.raw_screenshot_path.split(/[\\/]/).pop() : '',
          run: {
            id: result.run_id,
            mode: runById.get(result.run_id)!.mode,
            status: runById.get(result.run_id)!.status,
            createdAt: runById.get(result.run_id)!.created_at,
            iniName: (runById.get(result.run_id)!.ini_path || '').split(/[\\/]/).pop() || '',
            binName: (runById.get(result.run_id)!.bin_path || '').split(/[\\/]/).pop() || '',
            workerLog: runById.get(result.run_id)!.log || '',
          },
        })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取自动化记录失败' }, { status: 400 });
  }
}
