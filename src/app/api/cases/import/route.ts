import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

// Excel column header -> system field (exact match, case-insensitive)
const COLUMN_MAP: Record<string, string> = {
  'feature': 'feature',
  'test category': 'test_category',
  'characteristic': 'trait',
  'no.': 'case_no',
  'no': 'case_no',
  'case name': 'case_name',
  'priority': 'priority',
  'light': 'light',
  'temperature': 'temperature',
  'testing environment': 'test_env',
  'pre operation': 'pre_operation',
  'step': 'step',
  'expect result': 'expect_result',
  'note': 'note',
  'test result': 'test_result',
  'test comments': 'test_result_note',
  'jira link': 'jira_link',
  'tester': 'executor',
};

// Normalize header for matching
function normalizeHeader(key: string): string {
  return key
    .replace(/\uFEFF/g, '')
    .trim()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeCaseValue(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function buildCaseDedupKey(caseNo: string | null | undefined, caseName: string | null | undefined): string | null {
  const normalizedNo = normalizeCaseValue(caseNo);
  const normalizedName = normalizeCaseValue(caseName);

  if (normalizedNo) return `no:${normalizedNo}`;
  if (normalizedName) return `name:${normalizedName}`;
  return null;
}

// Priority mapping -> English
const PRIORITY_MAP: Record<string, string> = {
  'high': 'High', 'middle': 'Middle', 'low': 'Low',
  '高': 'High', '中': 'Middle', '低': 'Low',
  'p0': 'High', 'p1': 'Middle', 'p2': 'Low',
  '1': 'High', '2': 'Middle', '3': 'Low',
};

// Test result mapping -> English
const TEST_RESULT_MAP: Record<string, string> = {
  'pass': 'Pass', 'fail': 'Fail', 'block': 'Block',
  'passed': 'Pass', 'failed': 'Fail', 'blocked': 'Block',
  '通过': 'Pass', '失败': 'Fail',
};

// Map a test result value; returns null if NA (skip)
function mapTestResult(raw: string): string | null {
  const v = raw.trim();
  if (!v) return ''; // empty -> empty (import normally)
  const lower = v.toLowerCase();
  if (lower === 'na' || lower === 'n/a' || lower === 'N/A'.toLowerCase()) return null; // skip
  return TEST_RESULT_MAP[lower] || v;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!MANAGER_USERNAMES.includes(user.username)) {
      return NextResponse.json({ error: '仅管理者可导入' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectId = Number(formData.get('projectId'));

    if (!file) return NextResponse.json({ error: '请选择文件' }, { status: 400 });
    if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });

    const db = getDb();
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: number } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    // Load all users for Tester resolution
    const allUsers = db.prepare('SELECT id, username FROM users').all() as { id: number; username: string }[];
    const userByUsername = new Map(allUsers.map(u => [u.username, u]));

    const XLSX = await import('xlsx');
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    let totalImported = 0;
    let totalSkipped = 0;
    const errors: string[] = [];
    const sheetNames = workbook.SheetNames;

    if (sheetNames.length === 0) {
      return NextResponse.json({ error: 'Excel 文件中没有 Sheet' }, { status: 400 });
    }

    for (const sheetName of sheetNames) {
      // Skip Summary sheet
      if (sheetName.trim().toLowerCase() === 'summary') continue;

      const sheet = workbook.Sheets[sheetName];

      // Handle merged cells: fill merge content to all cells in the range
      const merges = sheet['!merges'] || [];
      if (merges.length > 0) {
        for (const merge of merges) {
          const { s, e } = merge; // start {r, c}, end {r, c}
          // Get the value of the top-left cell of the merge
          const ref = XLSX.utils.encode_cell(s);
          const cell = sheet[ref];
          const value = cell ? (cell.v !== undefined ? cell.v : '') : '';
          // Fill all cells in the merge range
          for (let r = s.r; r <= e.r; r++) {
            for (let c = s.c; c <= e.c; c++) {
              if (r === s.r && c === s.c) continue; // skip origin cell
              const cellRef = XLSX.utils.encode_cell({ r, c });
              if (!sheet[cellRef] || sheet[cellRef].v === undefined || sheet[cellRef].v === '') {
                sheet[cellRef] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
              }
            }
          }
        }
      }

      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
      if (rows.length === 0) continue;

      // Find or create module by sheet name
      const moduleRow = db.prepare('SELECT id FROM modules WHERE project_id = ? AND name = ?').get(projectId, sheetName) as { id: number } | undefined;
      let moduleId: number;

      if (moduleRow) {
        moduleId = moduleRow.id;
      } else {
        const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM modules WHERE project_id = ?').get(projectId) as { m: number | null };
        const result = db.prepare('INSERT INTO modules (project_id, name, sort_order) VALUES (?, ?, ?)').run(projectId, sheetName, (maxOrder.m || 0) + 1);
        moduleId = Number(result.lastInsertRowid);
      }

      // Prefer case_no for dedup because the same sheet can legitimately contain
      // multiple cases with the same case_name but different identifiers.
      const existingCases = db.prepare('SELECT case_no, case_name FROM cases WHERE module_id = ?').all(moduleId) as {
        case_no: string | null;
        case_name: string | null;
      }[];
      const existingCaseKeys = new Set(
        existingCases
          .map(c => buildCaseDedupKey(c.case_no, c.case_name))
          .filter((key): key is string => !!key)
      );

      // Parse column headers
      const firstRow = rows[0];
      const colMapping: Record<string, string> = {};

      for (const headerKey of Object.keys(firstRow)) {
        const normalized = normalizeHeader(headerKey);
        if (COLUMN_MAP[normalized] && !Object.values(colMapping).includes(COLUMN_MAP[normalized])) {
          colMapping[headerKey] = COLUMN_MAP[normalized];
        }
      }

      // Get sort order base
      const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM cases WHERE module_id = ?').get(moduleId) as { m: number | null };
      let sortOrder = (maxOrder.m || 0) + 1;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Build case data
        const caseData: Record<string, string> = {
          case_name: '',
          priority: 'Middle',
          test_env: '',
          test_device: '',
          pre_operation: '',
          step: '',
          expect_result: '',
          note: '',
          test_result: '',
          jira_link: '',
          fail_note: '',
          case_no: '',
          test_category: '',
          feature: '',
          trait: '',
          test_result_note: '',
          light: '',
          temperature: '',
          executor: '',
        };

        for (const [excelCol, systemField] of Object.entries(colMapping)) {
          const rawValue = String(row[excelCol] ?? '').trim();

          if (systemField === 'priority') {
            const key = rawValue.toLowerCase().trim();
            caseData[systemField] = PRIORITY_MAP[key] || rawValue || 'Middle';
          } else if (systemField === 'test_result') {
            // Will handle NA skip below
            caseData[systemField] = rawValue;
          } else {
            caseData[systemField] = rawValue;
          }
        }

        // Check test result: NA -> skip this case
        const testResultRaw = caseData.test_result;
        const mappedResult = mapTestResult(testResultRaw);
        if (mappedResult === null) {
          totalSkipped++;
          continue; // NA: skip
        }
        caseData.test_result = mappedResult;

        // Case name is required (can be empty per spec, but skip truly empty rows)
        const caseName = caseData.case_name;
        if (!caseName) {
          totalSkipped++;
          continue;
        }

        const caseKey = buildCaseDedupKey(caseData.case_no, caseName);
        if (!caseKey) {
          totalSkipped++;
          continue;
        }

        // Dedup check
        if (existingCaseKeys.has(caseKey)) {
          totalSkipped++;
          continue;
        }

        // Resolve tester assignment
        const testerName = caseData.executor;
        let testerUserId: number | null = null;
        if (testerName) {
          const testerUser = userByUsername.get(testerName);
          if (testerUser) {
            testerUserId = testerUser.id;
          }
        }

        // Insert case
        try {
          db.prepare(`
            INSERT INTO cases (module_id, case_name, case_no, test_category, feature, trait, priority, test_env, test_device, pre_operation, step, expect_result, note, test_result, jira_link, fail_note, test_result_note, light, temperature, executor, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            moduleId,
            caseData.case_name,
            caseData.case_no,
            caseData.test_category,
            caseData.feature,
            caseData.trait,
            caseData.priority,
            caseData.test_env,
            caseData.test_device,
            caseData.pre_operation,
            caseData.step,
            caseData.expect_result,
            caseData.note,
            caseData.test_result,
            caseData.jira_link,
            caseData.fail_note,
            caseData.test_result_note,
            caseData.light,
            caseData.temperature,
            caseData.executor,
            sortOrder++
          );

          // If tester specified and found, create assignment at case level
          if (testerUserId) {
            const caseId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
            try {
              db.prepare('INSERT OR REPLACE INTO assignments (level, target_id, user_id) VALUES (?, ?, ?)').run('case', caseId.id, testerUserId);
            } catch {
              // Assignment may already exist, ignore
            }
          }

          existingCaseKeys.add(caseKey);
          totalImported++;
        } catch (err) {
          errors.push(`Sheet「${sheetName}」用例「${caseName}」导入失败：${err instanceof Error ? err.message : '未知错误'}`);
          totalSkipped++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      imported: totalImported,
      skipped: totalSkipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Import cases error:', error);
    return NextResponse.json({ error: '导入失败：' + (error instanceof Error ? error.message : '未知错误') }, { status: 500 });
  }
}
