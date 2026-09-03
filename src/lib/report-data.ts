import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { parseJiraLinks } from '@/lib/jira-links';
import { verifyReportToken, type ReportTokenPayload } from '@/lib/auth';

export async function resolveReportPayload(key: string): Promise<ReportTokenPayload | null> {
  if (/^[A-Za-z0-9_-]{6,16}$/.test(key)) {
    const row = getDb().prepare(`SELECT scope, project_id, module_id, case_id, created_by FROM report_links WHERE code = ?`).get(key) as {
      scope: ReportTokenPayload['scope']; project_id: number; module_id: number | null; case_id: number | null; created_by: string;
    } | undefined;
    if (row && ['project', 'feature', 'case'].includes(row.scope)) {
      return { kind: 'report', scope: row.scope, projectId: row.project_id, moduleId: row.module_id || undefined, caseId: row.case_id || undefined, createdBy: row.created_by || '平台' };
    }
  }
  return verifyReportToken(key);
}

export function getOrCreateReportCode(input: Omit<ReportTokenPayload, 'kind' | 'feature'>): string {
  const db = getDb();
  const scopeKey = input.scope === 'project' ? `project:${input.projectId}` : input.scope === 'feature' ? `module:${input.moduleId}` : `case:${input.caseId}`;
  const existing = db.prepare('SELECT code FROM report_links WHERE scope_key = ?').get(scopeKey) as { code: string } | undefined;
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    try {
      db.prepare(`INSERT INTO report_links (code, scope_key, scope, project_id, module_id, case_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(code, scopeKey, input.scope, input.projectId, input.moduleId || null, input.caseId || null, input.createdBy);
      return code;
    } catch (error) {
      const raced = db.prepare('SELECT code FROM report_links WHERE scope_key = ?').get(scopeKey) as { code: string } | undefined;
      if (raced) return raced.code;
      if (attempt === 4) throw error;
    }
  }
  throw new Error('无法创建报告短链接');
}

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
  jiraIssues?: Array<{ link: string; issueKey: string; summary: string; priority: string; issueType: string; assigneeName: string; reporterName: string; statusName: string; projectName: string; updated: string; statusCategory: string; isDone: boolean }>;
  cases: ReportCase[];
  selectedCase: ReportCase | null;
}

export type ReportFileRecord = ReportFile & { caseId: number };

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

function chunks<T>(items: T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function referencedFileIds(html: string): number[] {
  return Array.from(html.matchAll(/\/api\/files\/(?:preview\/)?(\d+)/gi), match => Number(match[1]));
}

export function loadReportData(
  payload: ReportTokenPayload,
  requestedCaseId?: number,
  options: { includeAllCaseDetails?: boolean } = {},
): ReportData | null {
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
    if (payload.moduleId) {
      where += ' AND m.id = ?';
      params.push(payload.moduleId);
    } else {
      if (!payload.feature) return null;
      where += " AND COALESCE(c.feature, '') = ?";
      params.push(payload.feature);
    }
  } else if (payload.scope === 'case') {
    if (!payload.caseId) return null;
    where += ' AND c.id = ?';
    params.push(payload.caseId);
  }
  if (requestedCaseId && payload.scope !== 'case') {
    where += ' AND c.id = ?';
    params.push(requestedCaseId);
  }

  const rows = db.prepare(`
    SELECT c.id, c.module_id, c.case_no, c.case_name, c.test_category, c.feature, c.trait,
      c.priority, c.test_result, c.jira_link, c.executor, m.name AS module_name,
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
  if (requestedCaseId && rows.length !== 1) return null;

  // 汇总页只读取列表所需字段；Case详情只读取当前Case。离线导出才加载全部大文本，
  // 避免项目长期积累日志后，每次打开报告首页都把所有富文本载入内存。
  const detailIds = options.includeAllCaseDetails
    ? rows.map(row => row.id)
    : payload.scope === 'case'
      ? rows.map(row => row.id)
      : requestedCaseId && rows.some(row => row.id === requestedCaseId)
        ? [requestedCaseId]
        : [];
  const detailMap = new Map<number, Partial<CaseRow>>();
  for (const detailBatch of chunks(detailIds)) {
    const placeholders = detailBatch.map(() => '?').join(',');
    const details = db.prepare(`
      SELECT id, test_env, test_device, pre_operation, step, expect_result, note,
        test_result_note, test_log, light, temperature
      FROM cases WHERE id IN (${placeholders})
    `).all(...detailBatch) as Array<Partial<CaseRow> & { id: number }>;
    details.forEach(detail => detailMap.set(detail.id, detail));
  }

  const fileMap = new Map<number, ReportFile[]>();
  for (const detailBatch of chunks(detailIds)) {
    const placeholders = detailBatch.map(() => '?').join(',');
    const files = db.prepare(`
      SELECT id, case_id, original_name, file_size, file_type, storage_path, COALESCE(source, 'upload') AS source
      FROM files WHERE case_id IN (${placeholders}) ORDER BY created_at, id
    `).all(...detailBatch) as Array<{ id: number; case_id: number; original_name: string; file_size: number; file_type: string; storage_path: string; source: string }>;
    for (const file of files) {
      const list = fileMap.get(file.case_id) || [];
      list.push({ id: file.id, originalName: file.original_name, fileSize: file.file_size, fileType: file.file_type, storagePath: file.storage_path, source: file.source });
      fileMap.set(file.case_id, list);
    }
  }

  // 富文本允许从其他 Case 复制图片。此时图片仍属于原 Case，但当前日志已经引用它；
  // 将这类引用资源挂到当前报告 Case，保证在线和离线报告都能显示。
  const referencedByCase = new Map<number, Set<number>>();
  for (const row of rows) {
    const ids = new Set(referencedFileIds(String(detailMap.get(row.id)?.test_log || '')));
    if (ids.size > 0) referencedByCase.set(row.id, ids);
  }
  const allReferencedIds = Array.from(new Set(Array.from(referencedByCase.values()).flatMap(ids => Array.from(ids))));
  const referencedFiles = new Map<number, ReportFile>();
  for (const fileBatch of chunks(allReferencedIds)) {
    const placeholders = fileBatch.map(() => '?').join(',');
    const files = db.prepare(`
      SELECT id, original_name, file_size, file_type, storage_path, COALESCE(source, 'upload') AS source
      FROM files WHERE id IN (${placeholders})
    `).all(...fileBatch) as Array<{ id: number; original_name: string; file_size: number; file_type: string; storage_path: string; source: string }>;
    for (const file of files) {
      referencedFiles.set(file.id, { id: file.id, originalName: file.original_name, fileSize: file.file_size, fileType: file.file_type, storagePath: file.storage_path, source: file.source });
    }
  }
  for (const [caseId, ids] of referencedByCase) {
    const caseFiles = fileMap.get(caseId) || [];
    const existingIds = new Set(caseFiles.map(file => file.id));
    for (const id of ids) {
      const file = referencedFiles.get(id);
      if (file && !existingIds.has(id)) caseFiles.push(file);
    }
    fileMap.set(caseId, caseFiles);
  }

  const cases: ReportCase[] = rows.map(row => {
    const detail = detailMap.get(row.id) || {};
    return {
      id: row.id,
      moduleId: row.module_id,
      moduleName: row.module_name,
      caseNo: row.case_no || '',
      caseName: row.case_name || '',
      testCategory: row.test_category || '',
      feature: row.feature || '',
      trait: row.trait || '',
      priority: row.priority || '',
      testEnv: detail.test_env || '',
      testDevice: detail.test_device || '',
      preOperation: detail.pre_operation || '',
      step: detail.step || '',
      expectResult: detail.expect_result || '',
      note: detail.note || '',
      testResult: row.test_result,
      jiraLinks: parseJiraLinks(row.jira_link),
      testResultNote: detail.test_result_note || '',
      testLog: detail.test_log || '',
      executor: row.executor || '',
      testerName: row.tester_name || '未分配',
      light: detail.light || '',
      temperature: detail.temperature || '',
      files: fileMap.get(row.id) || [],
    };
  });

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

  const scopeModule = payload.moduleId
    ? db.prepare('SELECT name FROM modules WHERE id = ? AND project_id = ?').get(payload.moduleId, payload.projectId) as { name: string } | undefined
    : undefined;
  return {
    scope: payload.scope,
    scopeLabel: payload.scope === 'project' ? '项目' : payload.scope === 'feature' ? `特性：${scopeModule?.name || payload.feature || '未知'}` : '单个 Case',
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

export function loadReportFile(payload: ReportTokenPayload, fileId: number): ReportFileRecord | null {
  const db = getDb();
  const file = db.prepare(`
    SELECT f.id, f.case_id, f.original_name, f.file_size, f.file_type, f.storage_path,
      COALESCE(f.source, 'upload') AS source, m.project_id, m.id AS module_id, COALESCE(c.feature, '') AS feature
    FROM files f
    JOIN cases c ON c.id = f.case_id
    JOIN modules m ON m.id = c.module_id
    WHERE f.id = ?
  `).get(fileId) as {
    id: number; case_id: number; original_name: string; file_size: number; file_type: string;
    storage_path: string; source: string; project_id: number; module_id: number; feature: string;
  } | undefined;
  if (!file) return null;

  const directlyInScope = file.project_id === payload.projectId && (
    payload.scope === 'project'
    || (payload.scope === 'feature' && (payload.moduleId ? file.module_id === payload.moduleId : file.feature === payload.feature))
    || (payload.scope === 'case' && file.case_id === payload.caseId)
  );

  let referencedInScope = false;
  if (!directlyInScope) {
    let where = 'm.project_id = ?';
    const params: Array<number | string> = [payload.projectId];
    if (payload.scope === 'feature') {
      if (payload.moduleId) {
        where += ' AND m.id = ?';
        params.push(payload.moduleId);
      } else {
        where += " AND COALESCE(c.feature, '') = ?";
        params.push(payload.feature || '');
      }
    } else if (payload.scope === 'case') {
      where += ' AND c.id = ?';
      params.push(payload.caseId || 0);
    }
    const candidates = db.prepare(`
      SELECT c.test_log FROM cases c JOIN modules m ON m.id = c.module_id
      WHERE ${where} AND c.test_log LIKE ?
    `).all(...params, `%${fileId}%`) as Array<{ test_log: string }>;
    referencedInScope = candidates.some(item => referencedFileIds(item.test_log || '').includes(fileId));
  }
  if (!directlyInScope && !referencedInScope) return null;

  return {
    id: file.id,
    caseId: file.case_id,
    originalName: file.original_name,
    fileSize: file.file_size,
    fileType: file.file_type,
    storagePath: file.storage_path,
    source: file.source,
  };
}

export function sanitizeReportHtml(html: string, imageUrl: (fileId: number) => string): string {
  return html
    .replace(/<(script|iframe|object|embed|style|form|button)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|style|form|button|meta|link|base|input)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\ssrcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"')
    .replace(/(<img[^>]*\ssrc=["'])(?:https?:\/\/[^/"']+)?\/api\/files\/(?:preview\/)?(\d+)(?:\?[^"']*)?(["'])/gi, (_match, prefix: string, id: string, suffix: string) => `${prefix}${imageUrl(Number(id))}${suffix}`)
    .replace(/<img(?![^>]*\sloading=)/gi, '<img loading="lazy" decoding="async"');
}

export function fileDataUri(file: ReportFile): string | null {
  if (!fs.existsSync(file.storagePath)) return null;
  const extension = (file.fileType || path.extname(file.originalName)).toLowerCase();
  const mime: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.txt': 'text/plain', '.log': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
    '.xml': 'application/xml', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.md': 'text/markdown',
    '.ini': 'text/plain', '.conf': 'text/plain', '.cfg': 'text/plain', '.properties': 'text/plain',
    '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip',
    '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.ogg': 'video/ogg', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
  };
  const contentType = mime[extension] || 'application/octet-stream';
  return `data:${contentType};base64,${fs.readFileSync(file.storagePath).toString('base64')}`;
}
