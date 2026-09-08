import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb, getStoragePath } from '@/lib/db';

export type AutomationMode = 'single' | 'selected' | 'project';
type WorkerCase = { caseId: number; status: 'passed' | 'failed'; log: string; screenshot?: string; rawScreenshot?: string; frameId?: string | number; readings?: Array<{ index: number; value: number; hex: string }> };
type WorkerResult = { ok: boolean; cases: WorkerCase[]; error?: string };

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const automationSource = process.env.PIX_AUTOMATION_ROOT || 'F:\\Duxin\\fw_auto_copy';
const pixelIdeRoot = process.env.PIX_IDE_ROOT || 'F:\\Duxin\\IDE_resently\\pixelide_release\\PixelIDE_offline';
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9_.-]/g, '_');

/** automation/cases/ 下的内置用例代码，"修改代码" 窗口没有覆盖时用它。 */
export function builtinScriptPath(automationKey: string): string {
  return path.join(workspace, 'automation', 'cases', `${safeKey(automationKey)}.py`);
}

function appendRunLog(runId: string, chunk: string) {
  getDb().prepare(`UPDATE automation_runs SET log=COALESCE(log,'')||? WHERE id=?`).run(chunk, runId);
}

/** automation_runs 的启动时间列名：老库是 started_at，声明的 schema 是 created_at。 */
let runStartedColumn: string | null = null;
function getRunStartedColumn(db: ReturnType<typeof getDb>): string {
  if (runStartedColumn) return runStartedColumn;
  const columns = new Set(db.prepare('PRAGMA table_info(automation_runs)').all()
    .map(row => String((row as { name: unknown }).name)));
  runStartedColumn = columns.has('created_at') ? 'created_at' : 'started_at';
  return runStartedColumn;
}

function storeFile(caseId: number, filePath: string): number | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  // files.file_type 在本平台里存的是扩展名（含点），不是 MIME 类型，
  // 预览接口按扩展名判断能否内联显示。
  const ext = path.extname(filePath).toLowerCase() || '.dat';
  const info = fs.statSync(filePath);
  const result = getDb().prepare(`INSERT INTO files(case_id,filename,original_name,file_size,file_type,storage_path,source) VALUES(?,?,?,?,?,?,'automation')`)
    .run(caseId, path.basename(filePath), path.basename(filePath), info.size, ext, filePath);
  return Number(result.lastInsertRowid);
}

/** 把每个用例本次实际执行的代码写进运行目录，worker 通过 --script-dir 读取。
 *  用例存了覆盖代码就用覆盖，否则回落到 automation/cases/ 内置脚本。 */
function writeResolvedScripts(runDir: string, rows: Array<Record<string, unknown>>): string {
  const scriptsDir = path.join(runDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const row of rows) {
    const key = String(row.automation_key || '');
    if (!key) continue;
    const override = getDb().prepare(`SELECT source FROM automation_case_codes WHERE case_id=? AND automation_key=?`).get(row.id, key) as { source: string } | undefined;
    const source = override?.source?.trim()
      ? override.source
      : (fs.existsSync(builtinScriptPath(key)) ? fs.readFileSync(builtinScriptPath(key), 'utf-8') : null);
    if (source) fs.writeFileSync(path.join(scriptsDir, `${safeKey(key)}.py`), source, 'utf-8');
  }
  return scriptsDir;
}

/** 生成"一键导入"用的关键日志片段：只挑结论性信息，不搬整个 worker 输出。 */
export function buildImportHtml(run: Record<string, unknown>, result: Record<string, unknown>, caseNo: string): string {
  const lines = [
    `MAT130 自动化冒烟测试　运行 ${String(run.id)}`,
    `用例：${caseNo || `#${Number(result.case_id)}`}　状态：${String(result.status) === 'passed' ? '通过' : '失败'}　FrameID：${String(result.frame_id || '无')}`,
    `时间：${String(result.finished_at || '')}`,
  ];
  const readings = String(result.readings || '');
  if (readings) lines.push(`I2C 0x00CC 读数：${readings}`);
  lines.push('');
  lines.push(String(result.log || '').split(/\r?\n/).join('\n'));
  return lines.join('\n');
}

function finishRun(runId: string, result: WorkerResult | null, processLog: string, exitCode: number | null) {
  const db = getDb();
  const successful = exitCode === 0 && result?.ok === true;
  db.transaction(() => {
    for (const item of result?.cases || []) {
      const imageId = item.screenshot ? storeFile(item.caseId, item.screenshot) : null;
      const rawId = item.rawScreenshot ? storeFile(item.caseId, item.rawScreenshot) : null;
      const readings = item.readings?.map(v => `${v.index}: ${v.hex}`).join(' | ') || '';
      db.prepare(`INSERT INTO automation_case_results(run_id,case_id,status,log,screenshot_path,raw_screenshot_path,frame_id,readings,image_file_id,raw_file_id,finished_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`)
        .run(runId, item.caseId, item.status, item.log, item.screenshot || '', item.rawScreenshot || '', String(item.frameId || ''), readings, imageId, rawId);
      // 执行结果只落在 automation_case_results，由自动化控件展示；
      // 这里只同步 Pass/Fail 状态，日志正文等用户"一键导入"后再写进 test_log。
      db.prepare(`UPDATE cases SET test_result=?,updated_at=datetime('now','localtime') WHERE id=?`)
        .run(item.status === 'passed' ? 'Pass' : 'Fail', item.caseId);
    }
    db.prepare(`UPDATE automation_runs SET status=?,error=?,log=?,finished_at=datetime('now','localtime') WHERE id=?`)
      .run(successful ? 'passed' : 'failed', result?.error || (successful ? '' : `worker exit ${exitCode}`), processLog, runId);
  })();
}

export function startAutomationRun(input: { userId: number; mode: AutomationMode; caseIds: number[]; ini: Buffer; iniName: string; bin: Buffer; binName: string }) {
  const db = getDb();
  const ids = [...new Set(input.caseIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new Error('至少选择一个用例');
  const marks = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT c.id,c.case_name,c.case_no,c.step,c.expect_result,c.automation_key FROM cases c JOIN modules m ON m.id=c.module_id JOIN projects p ON p.id=m.project_id WHERE c.id IN (${marks}) ORDER BY p.sort_order,p.id,m.sort_order,m.id,c.sort_order,c.id`).all(...ids) as Array<Record<string, unknown>>;
  if (rows.length !== ids.length) throw new Error('包含不存在的用例');
  const unsupported = rows.filter(row => row.automation_key !== 'simple_i2c_00cc');
  if (unsupported.length) throw new Error(`以下用例尚未绑定执行代码：${unsupported.map(c => c.case_no || c.case_name).join('、')}`);

  const runId = crypto.randomUUID();
  const runDir = path.join(getStoragePath(), 'automation', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const iniPath = path.join(runDir, path.basename(input.iniName));
  const binPath = path.join(runDir, path.basename(input.binName));
  fs.writeFileSync(iniPath, input.ini);
  fs.writeFileSync(binPath, input.bin);
  const scriptsDir = writeResolvedScripts(runDir, rows);
  const runStartedAt = getRunStartedColumn(db);
  db.prepare(`INSERT INTO automation_runs(id,requested_by,mode,status,case_ids,ini_path,bin_path,${runStartedAt})
              VALUES(?,?,?,'queued',?,?,?,datetime('now','localtime'))`)
    .run(runId, input.userId, input.mode, JSON.stringify(ids), iniPath, binPath);

  const args = ['-3.12', path.join(workspace, 'automation', 'pix_case_runner.py'),
    '--run-id', runId, '--ini', iniPath, '--bin', binPath, '--output', runDir,
    '--cases', JSON.stringify(rows), '--automation-root', automationSource,
    '--pixel-ide-root', pixelIdeRoot, '--script-dir', scriptsDir];
  const child = spawn('py', args, { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  db.prepare(`UPDATE automation_runs SET status='running' WHERE id=?`).run(runId);
  let output = '';
  child.stdout.on('data', c => { output += c; appendRunLog(runId, String(c)); });
  child.stderr.on('data', c => { output += c; appendRunLog(runId, String(c)); });
  child.on('error', e => finishRun(runId, { ok: false, cases: [], error: e.message }, output, -1));
  child.on('close', code => {
    const marker = output.split(/\r?\n/).reverse().find(x => x.startsWith('AUTOMATION_RESULT='));
    let parsed: WorkerResult | null = null;
    try { if (marker) parsed = JSON.parse(marker.slice('AUTOMATION_RESULT='.length)); } catch { /* keep null */ }
    finishRun(runId, parsed, output, code);
  });
  return runId;
}

export function getAutomationRun(runId: string, userId: number, isManager: boolean) {
  const db = getDb();
  const run = db.prepare(`SELECT * FROM automation_runs WHERE id=?`).get(runId) as Record<string, unknown> | undefined;
  if (!run || (!isManager && Number(run.requested_by) !== userId)) return null;
  return { ...run, case_ids: JSON.parse(String(run.case_ids)), cases: db.prepare(`SELECT * FROM automation_case_results WHERE run_id=? ORDER BY id`).all(runId) };
}
