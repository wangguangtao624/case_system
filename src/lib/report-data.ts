import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';
import { parseJiraLinks } from '@/lib/jira-links';
import type { ReportTokenPayload } from '@/lib/auth';

export interface ReportFile {
  id: number;
  originalName: string;
  fileSize: number;
  fileType: string;
  storagePath: string;
  source: string;
}

export interface ReportCase {
  id: number;
  moduleId: number;
  moduleName: string;
  caseNo: string;
  caseName: string;
  testCategory: string;
  feature: string;
  trait: string;
  priority: string;
  testEnv: string;
  testDevice: string;
  preOperation: string;
  step: string;
  expectResult: string;
  note: string;
  testResult: string | null;
  jiraLinks: string[];
  testResultNote: string;
  testLog: string;
  executor: string;
  testerName: string;
  light: string;
  temperature: string;
  files: ReportFile[];
}

export interface ReportData {
  scope: ReportTokenPayload['scope'];
  scopeLabel: string;
  generatedBy: string;
  project: {
    id: number;
    name: string;
    archivedAt: string | null;
    archivedBy: string;
    archiveNote: string;
    startDate: string | null;
    endDate: string | null;
  };
  summary: {
    total: number;
    completed: number;
    incomplete: number;
    passed: number;
    failed: number;
    blocked: number;
    completionRate: number;
    passRate: number;
  };
  jiraLinks: Array<{ link: string; caseIds: number[] }>;
  cases: ReportCase[];
  selectedCase: ReportCase | null;
}

type CaseRow = {
  id: number;
  module_id: number;
  module_name: string;
  case_no: string;
  case_name: string;
  test_category: string;
  feature: string;
  trait: string;
  priority: string;
  test_env: string;
  test_device: string;
  pre_operation: string;
  step: string;
  expect_result: string;
  note: string;
  test_result: string | null;
  jira_link: string;
  test_result_note: string;
  test_log: string;
  executor: string;
  tester_name: string | null;
  light: string;
  temperature: string;
};

function rate(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

export function loadReportData(payload: ReportTokenPayload, requestedCaseId?: number): ReportData | null {
  const db = getDb();
  const project = db.prepare(`
    SELECT id, name, publish_status, archived_at, archived_by, archive_note, start_date, end_date
    FROM projects WHERE id = ?
  `).get(payload.projectId) as {
    id: number;
    name: string;
    publish_status: string;
    archived_at: string | null;
    archived_by: string;
    archive_note: string;
    start_date: string | null;
    end_date: string | null;
  } | undefined;
  if (!project || project.publish_status === 'draft') return null;

  let where = 'm.project_id = ?';
  const params: Array<number | string> = [payload.projectId];
  if (payload.scope === 'feature') {
    if (!payload.feature) return null;
    where += " AND COALESCE(c.feature, '') = ?";
    params.push(payload.feature);
  } else if (payload.scope === 'case') {
    if (!payload.caseId) return null;
    where += ' AND c.id = ?';
    params.push(payload.caseId);
  }

  const rows = db.prepare(`
    SELECT c.*, m.name AS module_name,
      COALESCE(cu.username, mu.username, pu.username, c.executor, '未分配') AS tester_name
    FROM cases c
    JOIN modules m ON m.id = c.module_id
    LEFT JOIN assignments ca ON ca.level = 'case' AND ca.target_id = c.id
    LEFT JOIN users cu ON cu.id = ca.user_id
    LEFT JOIN assignments ma ON ma.level = 'module' AND ma.target_id = m.id
    LEFT JOIN users mu ON mu.id = ma.user_id
    LEFT JOIN assignments pa ON pa.level = 'project' AND pa.target_id = m.project_id
    LEFT JOIN users pu ON pu.id = pa.user_id
    WHERE ${where}
    ORDER BY m.sort_order, m.id, c.sort_order, c.id
  `).all(...params) as CaseRow[];

  if (payload.scope === 'case' && rows.length !== 1) return null;
  const caseIds = rows.map(row => row.id);
  const fileMap = new Map<number, ReportFile[]>();
  if (caseIds.length > 0) {
    const placeholders = caseIds.map(() => '?').join(',');
    const files = db.prepare(`
      SELECT id, case_id, original_name, file_size, file_type, storage_path, COALESCE(source, 'upload') AS source
      FROM files WHERE case_id IN (${placeholders}) ORDER BY created_at, id
    `).all(...caseIds) as Array<{ id: number; case_id: number; original_name: string; file_size: number; file_type: string; storage_path: string; source: string }>;
    for (const file of files) {
      const list = fileMap.get(file.case_id) || [];
      list.push({ id: file.id, originalName: file.original_name, fileSize: file.file_size, fileType: file.file_type, storagePath: file.storage_path, source: file.source });
      fileMap.set(file.case_id, list);
    }
  }

  const cases: ReportCase[] = rows.map(row => ({
    id: row.id,
    moduleId: row.module_id,
    moduleName: row.module_name,
    caseNo: row.case_no || '',
    caseName: row.case_name || '',
    testCategory: row.test_category || '',
    feature: row.feature || '',
    trait: row.trait || '',
    priority: row.priority || '',
    testEnv: row.test_env || '',
    testDevice: row.test_device || '',
    preOperation: row.pre_operation || '',
    step: row.step || '',
    expectResult: row.expect_result || '',
    note: row.note || '',
    testResult: row.test_result,
    jiraLinks: parseJiraLinks(row.jira_link),
    testResultNote: row.test_result_note || '',
    testLog: row.test_log || '',
    executor: row.executor || '',
    testerName: row.tester_name || '未分配',
    light: row.light || '',
    temperature: row.temperature || '',
    files: fileMap.get(row.id) || [],
  }));

  const passed = cases.filter(item => item.testResult === 'Pass').length;
  const failed = cases.filter(item => item.testResult === 'Fail').length;
  const blocked = cases.filter(item => item.testResult === 'Block').length;
  const completed = passed + failed + blocked;
  const jiraMap = new Map<string, number[]>();
  for (const item of cases) {
    for (const link of item.jiraLinks) {
      const ids = jiraMap.get(link) || [];
      ids.push(item.id);
      jiraMap.set(link, ids);
    }
  }
  const selectedId = payload.scope === 'case' ? payload.caseId : requestedCaseId;

  return {
    scope: payload.scope,
    scopeLabel: payload.scope === 'project' ? '项目' : payload.scope === 'feature' ? `特性：${payload.feature}` : '单个 Case',
    generatedBy: payload.createdBy,
    project: {
      id: project.id,
      name: project.name,
      archivedAt: project.archived_at,
      archivedBy: project.archived_by || '',
      archiveNote: project.archive_note || '',
      startDate: project.start_date,
      endDate: project.end_date,
    },
    summary: {
      total: cases.length,
      completed,
      incomplete: cases.length - completed,
      passed,
      failed,
      blocked,
      completionRate: rate(completed, cases.length),
      passRate: rate(passed, completed),
    },
    jiraLinks: Array.from(jiraMap, ([link, ids]) => ({ link, caseIds: ids })),
    cases,
    selectedCase: cases.find(item => item.id === selectedId) || null,
  };
}

export function sanitizeReportHtml(html: string, imageUrl: (fileId: number) => string): string {
  return html
    .replace(/<(script|iframe|object|embed|style|form|button)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|style|form|button|meta|link|base|input)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\ssrcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"')
    .replace(/(<img[^>]*\ssrc=["'])(?:https?:\/\/[^/"']+)?\/api\/files\/(?:preview\/)?(\d+)(?:\?[^"']*)?(["'])/gi, (_match, prefix: string, id: string, suffix: string) => `${prefix}${imageUrl(Number(id))}${suffix}`);
}

export function fileDataUri(file: ReportFile): string | null {
  if (!fs.existsSync(file.storagePath)) return null;
  const extension = (file.fileType || path.extname(file.originalName)).toLowerCase();
  const mime: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  };
  const contentType = mime[extension];
  if (!contentType) return null;
  return `data:${contentType};base64,${fs.readFileSync(file.storagePath).toString('base64')}`;
}
