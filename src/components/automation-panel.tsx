'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const BLUE = '#0073E6';
const BORDER = '#E5E7EB';
const TEXT_MAIN = '#374151';
const TEXT_SUB = '#6B7280';

type AutomationEntry = {
  id: number;
  status: string;
  log: string;
  readings: string;
  frameId: string;
  finishedAt: string;
  previewUrl: string;
  rawDownloadUrl: string;
  rawName: string;
  run: {
    id: string;
    mode: string;
    status: string;
    createdAt: string;
    iniName: string;
    binName: string;
    workerLog: string;
  };
};

type AutomationPanelData = {
  case: { id: number; case_no: string; case_name: string; automation_key: string; test_result: string | null };
  entries: AutomationEntry[];
};

type CaseCode = {
  success: boolean;
  case: { id: number; case_no: string; case_name: string; automation_key: string };
  automationKey: string;
  source: string;
  overridden: boolean;
  builtinPath: string;
  updatedAt: string;
  canEdit: boolean;
  note?: string;
};

const MODE_LABEL: Record<string, string> = { single: '单用例', selected: '批量', project: '整项目' };

/** 把一条执行结果整理成可导入"测试过程及日志"的关键信息（纯文本，编辑器按段落写入）。
 *  只取结论性内容；worker 进程的 DLL attach/detach 噪声留在控件里看。 */
export function buildAutomationImportText(entry: AutomationEntry, includeWorkerLog = false): string {
  const lines = [
    `【自动化冒烟测试】运行 ${entry.run.id}　模式 ${MODE_LABEL[entry.run.mode] || entry.run.mode}　` +
      `结果 ${entry.status === 'passed' ? '通过' : '失败'}　FrameID ${entry.frameId || '无'}　时间 ${entry.finishedAt || ''}`,
    `INI：${entry.run.iniName || '—'}　BIN：${entry.run.binName || '—'}`,
  ];
  if (entry.readings) lines.push(`I2C 0x00CC 读数：${entry.readings}`);
  if (entry.frameId) lines.push(`抓帧图像：FrameID ${entry.frameId}${entry.previewUrl ? '' : '（无预览图）'}`);
  lines.push('');
  lines.push('执行日志：');
  lines.push(entry.log);
  if (includeWorkerLog && entry.run.workerLog) {
    lines.push('');
    lines.push('--- worker 进程日志 ---');
    lines.push(entry.run.workerLog);
  }
  return lines.join('\n');
}

function StatusDot({ status }: { status: string }) {
  const passed = status === 'passed';
  const running = ['queued', 'running'].includes(status);
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: passed ? '#16A34A' : running ? '#2563EB' : '#DC2626' }}
    />
  );
}

export function AutomationRunPanel({
  caseId,
  canImport,
  onImport,
  onImportNotice,
}: {
  caseId: number;
  canImport: boolean;
  onImport: (text: string) => void;
  onImportNotice: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<AutomationPanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openLogs, setOpenLogs] = useState<Set<number>>(new Set());
  const [openWorkerLogs, setOpenWorkerLogs] = useState<Set<number>>(new Set());
  const [importWithWorkerLog, setImportWithWorkerLog] = useState(false);
  const [showCodeFor, setShowCodeFor] = useState<number | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/automation/case-runs/${caseId}?_t=${Date.now()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '读取自动化记录失败');
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取自动化记录失败');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    setExpanded(false);
    setOpenLogs(new Set());
    setOpenWorkerLogs(new Set());
    setShowCodeFor(null);
    void load(true);
  }, [caseId, load]);

  const makeToggle = (setter: React.Dispatch<React.SetStateAction<Set<number>>>) =>
    (id: number) => setter(current => {
      const copy = new Set(current);
      if (copy.has(id)) copy.delete(id); else copy.add(id);
      return copy;
    });
  const toggleLog = makeToggle(setOpenLogs);
  const toggleWorkerLog = makeToggle(setOpenWorkerLogs);

  const entries = data?.entries || [];
  const latest = entries[0];

  return (
    <>
      <div className="rounded-lg border mb-4" style={{ borderColor: BORDER, backgroundColor: '#FFFFFF' }}>
        {/* 折叠态：单行控件，点击整行展开 */}
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left"
          style={{ borderRadius: 8 }}
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: '#F59E0B' }} />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
            <span className="text-sm font-semibold" style={{ color: TEXT_MAIN }}>自动化执行记录</span>
            {entries.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[11px] font-medium" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                {entries.length}
              </span>
            )}
            {latest && (
              <span className="text-xs flex items-center gap-1" style={{ color: TEXT_SUB }}>
                最近一次：
                <StatusDot status={latest.status} />
                <span style={{ color: latest.status === 'passed' ? '#16A34A' : '#DC2626' }}>
                  {latest.status === 'passed' ? '通过' : '失败'}
                </span>
                {latest.frameId && <span>· FrameID {latest.frameId}</span>}
              </span>
            )}
            {data && entries.length === 0 && <span className="text-xs" style={{ color: TEXT_SUB }}>暂无记录</span>}
            {loading && <span className="text-xs" style={{ color: TEXT_SUB }}>加载中…</span>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs" style={{ color: TEXT_SUB }}>{expanded ? '收起' : '展开'}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </button>

        {/* 展开态：执行日志 + 抓取图像 */}
        {expanded && (
          <div className="border-t px-4 py-3" style={{ borderColor: BORDER }}>
            {error && (
              <div className="mb-3 p-2.5 rounded text-xs" style={{ backgroundColor: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}>
                {error}
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <div className="text-xs" style={{ color: TEXT_SUB }}>
                {data?.case?.case_no || `#${caseId}`}　{data?.case?.case_name || ''}
                {data?.case?.automation_key ? <span className="ml-2">执行代码：<code>{data.case.automation_key}</code></span> : null}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs cursor-pointer select-none" style={{ color: TEXT_SUB }}
                  title="勾选后，一键导入会连带 worker 进程的完整日志（含 DLL 初始化输出）">
                  <input type="checkbox" checked={importWithWorkerLog} onChange={e => setImportWithWorkerLog(e.target.checked)}
                    className="h-3 w-3" />
                  导入完整进程日志
                </label>
                <button type="button" onClick={() => void load()} disabled={loading}
                  className="px-2.5 py-1 rounded text-xs border disabled:opacity-40"
                  style={{ borderColor: BORDER, color: TEXT_SUB }}>
                  {loading ? '刷新中…' : '刷新'}
                </button>
                <button type="button" onClick={() => setShowCodeFor(caseId)}
                  className="px-2.5 py-1 rounded text-xs border"
                  style={{ borderColor: BORDER, color: TEXT_MAIN }}>
                  修改代码
                </button>
              </div>
            </div>

            {entries.length === 0 && !loading ? (
              <div className="py-6 text-center text-xs" style={{ color: TEXT_SUB }}>
                这个用例还没有自动化执行记录。在左侧目录上点击用例的闪电按钮运行冒烟测试，结果会显示在这里。
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map(entry => {
                  const readings = entry.readings ? entry.readings.split(' | ') : [];
                  return (
                    <div key={entry.id} className="rounded-md border" style={{ borderColor: BORDER }}>
                      <div className="flex items-center justify-between gap-3 px-3 py-2" style={{ backgroundColor: '#FAFBFC' }}>
                        <div className="flex items-center gap-2 min-w-0 text-xs">
                          <StatusDot status={entry.status} />
                          <span className="font-semibold" style={{ color: entry.status === 'passed' ? '#16A34A' : '#DC2626' }}>
                            {entry.status === 'passed' ? '通过' : '失败'}
                          </span>
                          <span style={{ color: TEXT_SUB }}>运行 {entry.run.id.slice(0, 8)}</span>
                          <span style={{ color: TEXT_SUB }}>({MODE_LABEL[entry.run.mode] || entry.run.mode})</span>
                          {entry.frameId && <span style={{ color: TEXT_SUB }}>FrameID {entry.frameId}</span>}
                          {entry.finishedAt && <span style={{ color: TEXT_SUB }}>{entry.finishedAt}</span>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button type="button"
                            onClick={() => toggleLog(entry.id)}
                            className="px-2 py-1 rounded text-xs border" style={{ borderColor: BORDER, color: TEXT_MAIN }}>
                            {openLogs.has(entry.id) ? '收起日志' : '查看日志'}
                          </button>
                          <button type="button"
                            disabled={!canImport}
                            title={canImport
                              ? (importWithWorkerLog
                                ? '把关键日志信息 + worker 完整进程日志追加到"测试过程及日志"'
                                : '把关键日志信息追加到"测试过程及日志"')
                              : '当前无编辑权限'}
                            onClick={() => {
                              onImport(buildAutomationImportText(entry, importWithWorkerLog));
                              onImportNotice(
                                `已把运行 ${entry.run.id.slice(0, 8)} 的关键日志追加到"测试过程及日志"`
                                + (importWithWorkerLog ? '（含完整进程日志）' : '') + '，记得点保存');
                            }}
                            className="px-2 py-1 rounded text-xs text-white disabled:opacity-40"
                            style={{ backgroundColor: BLUE }}>
                            一键导入
                          </button>
                        </div>
                      </div>

                      <div className="px-3 py-2 space-y-2">
                        <div className="flex items-center gap-4 text-xs" style={{ color: TEXT_SUB }}>
                          <span>INI：<code style={{ color: TEXT_MAIN }}>{entry.run.iniName || '—'}</code></span>
                          <span>BIN：<code style={{ color: TEXT_MAIN }}>{entry.run.binName || '—'}</code></span>
                        </div>

                        {readings.length > 0 && (
                          <div>
                            <div className="text-xs mb-1" style={{ color: TEXT_SUB }}>I2C 0x00CC 读数</div>
                            <div className="flex flex-wrap gap-1">
                              {readings.map(item => (
                                <span key={item} className="px-1.5 py-0.5 rounded text-[11px] font-mono"
                                  style={{ backgroundColor: '#F3F4F6', color: TEXT_MAIN }}>{item}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {(entry.previewUrl || entry.rawDownloadUrl) && (
                          <div className="flex items-start gap-3">
                            {entry.previewUrl && (
                              <a href={entry.previewUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
                                <img src={entry.previewUrl} alt="自动化抓帧"
                                  className="rounded border"
                                  style={{ width: 200, height: 'auto', borderColor: BORDER, maxHeight: 140, objectFit: 'cover' }}
                                />
                              </a>
                            )}
                            <div className="text-xs space-y-1" style={{ color: TEXT_SUB }}>
                              <div>抓帧图像：FrameID {entry.frameId || '无'}（点击图片看大图）</div>
                              {entry.rawDownloadUrl && (
                                <a href={entry.rawDownloadUrl} style={{ color: BLUE }} className="hover:underline break-all">
                                  下载原始 YUV：{entry.rawName || '原始帧'}
                                </a>
                              )}
                            </div>
                          </div>
                        )}

                        {openLogs.has(entry.id) && (
                          <pre className="text-xs p-3 rounded overflow-auto whitespace-pre-wrap"
                            style={{ backgroundColor: '#0F172A', color: '#BBF7D0', maxHeight: 320, fontSize: 11.5 }}>
                            {entry.log || '（无日志）'}
                          </pre>
                        )}
                        <button type="button" onClick={() => toggleWorkerLog(entry.id)}
                          className="text-xs hover:underline" style={{ color: TEXT_SUB }}>
                          {openWorkerLogs.has(entry.id) ? '收起 worker 进程日志' : '查看 worker 进程日志'}
                        </button>
                        {openWorkerLogs.has(entry.id) && (
                          <pre className="text-xs p-3 rounded overflow-auto whitespace-pre-wrap"
                            style={{ backgroundColor: '#F8FAFC', color: TEXT_MAIN, borderColor: BORDER, border: `1px solid ${BORDER}`, maxHeight: 260, fontSize: 11 }}>
                            {entry.run.workerLog || '（无）'}
                          </pre>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {showCodeFor !== null && (
        createPortal(<AutomationCodeDialog caseId={showCodeFor} onClose={() => setShowCodeFor(null)} onNotice={onImportNotice} />, document.body)
      )}
    </>
  );
}

function AutomationCodeDialog({ caseId, onClose, onNotice }: { caseId: number; onClose: () => void; onNotice: (text: string) => void }) {
  const [code, setCode] = useState<CaseCode | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/automation/code?caseId=${caseId}&_t=${Date.now()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || '读取用例代码失败');
        if (cancelled) return;
        setCode(body);
        setDraft(body.source || '');
      })
      .catch(cause => {
        if (!cancelled) setMessage({ type: 'error', text: cause instanceof Error ? cause.message : '读取失败' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [caseId]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/automation/code', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, source: draft }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || '保存失败');
      setMessage({ type: 'success', text: '已保存并通过语法检查，下次运行本用例即生效' });
      onNotice(`用例 ${caseId} 的自动化执行代码已更新`);
      setCode(current => current ? { ...current, overridden: true, updatedAt: '刚刚' } : current);
    } catch (cause) {
      setMessage({ type: 'error', text: cause instanceof Error ? cause.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/automation/code?caseId=${caseId}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || '恢复失败');
      setMessage({ type: 'success', text: `已恢复内置默认脚本（删除了 ${body.removed} 条覆盖记录）` });
      onNotice(`用例 ${caseId} 的自动化执行代码已恢复默认`);
      void fetch(`/api/automation/code?caseId=${caseId}&_t=${Date.now()}`).then(async response => {
        const fresh = await response.json();
        if (fresh.success) {
          setCode(fresh);
          setDraft(fresh.source || '');
        }
      });
    } catch (cause) {
      setMessage({ type: 'error', text: cause instanceof Error ? cause.message : '恢复失败' });
    } finally {
      setSaving(false);
    }
  };

  const showBuiltinNotice = Boolean(code && !code.overridden && code.automationKey);

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.42)' }}>
      <div className="bg-white rounded-xl shadow-2xl p-5 w-[860px] max-w-[94vw] max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-bold">修改执行代码 · {code?.case?.case_no || `#${caseId}`}</h3>
            <p className="text-xs mt-0.5" style={{ color: TEXT_SUB }}>
              {code?.note || (
                <>执行代码键：<code>{code?.automationKey}</code>　
                  {code?.overridden
                    ? <>已保存用例级覆盖（修改时间 {code.updatedAt}）</>
                    : <>当前是内置默认脚本 {code?.builtinPath || ''}，保存后仅对本用例生效</>}
                </>
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400" aria-label="关闭">×</button>
        </div>

        {loading && <div className="py-10 text-center text-sm" style={{ color: TEXT_SUB }}>加载代码中…</div>}

        {!loading && code && !code.automationKey && (
          <div className="py-8 text-center text-sm" style={{ color: TEXT_SUB }}>{code.note}</div>
        )}

        {!loading && code && code.automationKey && (
          <>
            {showBuiltinNotice && (
              <div className="mt-3 px-3 py-2 rounded text-xs" style={{ backgroundColor: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>
                这段代码是 automation/cases/ 下的内置脚本，尚未针对该用例做过修改。直接保存会创建一份只属于该用例的副本。
              </div>
            )}
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              spellCheck={false}
              readOnly={code.canEdit !== true}
              placeholder="# 用例必须定义 def run(ctx)，ctx 提供 capture_frame / read_i2c / detect_firmware_slave 等能力"
              className="mt-3 w-full rounded border p-3 font-mono"
              style={{
                minHeight: 420, fontSize: 12, lineHeight: 1.55, borderColor: BORDER,
                backgroundColor: code.canEdit === true ? '#FFFFFF' : '#F9FAFB', resize: 'vertical',
              }}
            />
            {code.canEdit !== true && (
              <div className="mt-2 text-xs" style={{ color: '#B45309' }}>
                只有管理员或该用例的执行人可以修改执行代码，当前为只读查看。
              </div>
            )}

            <div className="mt-2 text-xs flex items-center justify-between" style={{ color: TEXT_SUB }}>
              <span>{draft.length} 字符　共 {draft.split('\n').length} 行</span>
              {message && (
                <span style={{ color: message.type === 'success' ? '#16A34A' : '#DC2626' }}>{message.text}</span>
              )}
            </div>
          </>
        )}

        <div className="flex justify-between gap-2 mt-4">
          <div>
            {code?.canEdit === true && code.overridden && (
              <button onClick={() => void revert()} disabled={saving}
                className="px-3 py-2 border rounded text-sm disabled:opacity-40"
                style={{ borderColor: BORDER, color: '#B45309' }}
                title="删除本用例的覆盖代码，回到 automation/cases/ 下的内置脚本">
                恢复默认代码
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border rounded" style={{ borderColor: BORDER }}>关闭</button>
            {code?.canEdit === true && code.automationKey && (
              <button onClick={() => void save()} disabled={saving || !draft.trim()}
                className="px-4 py-2 text-white rounded disabled:opacity-40" style={{ backgroundColor: BLUE }}>
                {saving ? '保存中…' : '保存代码'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
