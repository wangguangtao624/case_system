import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

// Excel column headers in EXACT fixed order (as per spec)
const EXPORT_COLUMNS = [
  { header: 'No.', field: 'case_no' },
  { header: 'Test category', field: 'test_category' },
  { header: 'Feature', field: 'feature' },
  { header: 'Characteristic', field: 'trait' },
  { header: 'Case name', field: 'case_name' },
  { header: 'Priority', field: 'priority' },
  { header: 'Testing environment', field: 'test_env' },
  { header: 'Light', field: 'light' },
  { header: 'Temperature', field: 'temperature' },
  { header: 'Pre operation', field: 'pre_operation' },
  { header: 'Step', field: 'step' },
  { header: 'Expect result', field: 'expect_result' },
  { header: 'Note', field: 'note' },
  { header: 'Test Result', field: 'test_result' },
  { header: 'Jira Link', field: 'jira_link' },
  { header: 'Test Comments', field: 'test_result_note' },
  { header: 'Tester', field: 'tester_name' },
];

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!MANAGER_USERNAMES.includes(user.username)) {
      return NextResponse.json({ error: '仅管理者可导出' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = Number(searchParams.get('projectId'));
    if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

    const db = getDb();

    // Get project name
    const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as { id: number; name: string } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    // Get all modules under this project
    const modules = db.prepare('SELECT id, name FROM modules WHERE project_id = ? ORDER BY sort_order, id').all(projectId) as { id: number; name: string }[];

    // Get all assignments for resolving tester names
    const assignments = db.prepare(`
      SELECT a.level, a.target_id, u.username as tester_name
      FROM assignments a
      JOIN users u ON a.user_id = u.id
    `).all() as { level: string; target_id: number; tester_name: string }[];

    // Build assignment lookup: "level-targetId" -> tester_name
    const assignmentMap = new Map<string, string>();
    for (const a of assignments) {
      assignmentMap.set(`${a.level}-${a.target_id}`, a.tester_name);
    }

    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();

    for (const mod of modules) {
      const cases = db.prepare(`
        SELECT c.* FROM cases c WHERE c.module_id = ? ORDER BY c.sort_order, c.id
      `).all(mod.id) as Record<string, unknown>[];

      if (cases.length === 0) continue;

      // Build rows
      const rows: Record<string, string>[] = [];

      for (const c of cases) {
        // Resolve tester name: case-level > module-level > project-level
        const caseId = c.id as number;
        const resolvedTester =
          assignmentMap.get(`case-${caseId}`) ||
          assignmentMap.get(`module-${mod.id}`) ||
          assignmentMap.get(`project-${projectId}`) ||
          (c.executor as string) ||
          '';

        const row: Record<string, string> = {};
        for (const col of EXPORT_COLUMNS) {
          if (col.field === 'tester_name') {
            row[col.header] = resolvedTester;
          } else {
            row[col.header] = String(c[col.field] ?? '');
          }
        }
        rows.push(row);
      }

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(rows, {
        header: EXPORT_COLUMNS.map(c => c.header),
      });

      // Set column widths
      ws['!cols'] = EXPORT_COLUMNS.map(col => {
        const widths: Record<string, number> = {
          'No.': 6, 'Test category': 12, 'Feature': 16, 'Characteristic': 12,
          'Case name': 30, 'Priority': 8, 'Testing environment': 16,
          'Light': 8, 'Temperature': 10, 'Pre operation': 16, 'Step': 30,
          'Expect result': 20, 'Note': 16, 'Test Result': 10,
          'Test Comments': 16, 'Jira Link': 24, 'Tester': 10,
        };
        return { wch: widths[col.header] || 12 };
      });

      // Sheet name: truncate to 31 chars (Excel limit)
      const sheetName = mod.name.length > 31 ? mod.name.substring(0, 31) : mod.name;
      XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    }

    // Generate buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Return as downloadable file
    const filename = encodeURIComponent(`${project.name}.xlsx`);
    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
      },
    });
  } catch (error) {
    console.error('Export cases error:', error);
    return NextResponse.json({ error: '导出失败：' + (error instanceof Error ? error.message : '未知错误') }, { status: 500 });
  }
}
