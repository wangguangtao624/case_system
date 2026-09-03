import { notFound } from 'next/navigation';
import { isHttpJiraLink } from '@/lib/jira-links';
import { loadReportData, resolveReportPayload, sanitizeReportHtml, type ReportCase } from '@/lib/report-data';
import { ReportDownloadButton } from '@/components/report-download-button';
import { ReportLogViewer } from '@/components/report-log-viewer';
import { fetchJiraIssues } from '@/lib/jira-issues';

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const resultStyle: Record<string, { color: string; background: string }> = {
  Pass: { color: '#166534', background: '#DCFCE7' },
  Fail: { color: '#991B1B', background: '#FEE2E2' },
  Block: { color: '#9A3412', background: '#FFEDD5' },
};

function caseTitle(item: ReportCase) {
  return [item.caseNo, item.caseName].filter(Boolean).join(' ') || '未命名 Case';
}

function getStats(cases: ReportCase[]) {
  const passed = cases.filter(item => item.testResult === 'Pass').length;
  const failed = cases.filter(item => item.testResult === 'Fail').length;
  const blocked = cases.filter(item => item.testResult === 'Block').length;
  const completed = passed + failed + blocked;
  return { total: cases.length, completed, passed, failed, rate: cases.length ? Math.round(completed / cases.length * 1000) / 10 : 0 };
}

function ReadonlyRow({ label, value, full = false }: { label: string; value?: string | null; full?: boolean }) {
  return (
    <div className={full ? 'md:col-span-2 grid grid-cols-[88px_1fr] border-t' : 'grid grid-cols-[88px_1fr] border-t'} style={{ borderColor: '#EEF2F7' }}>
      <div className="px-3 py-2 text-xs font-medium" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #EEF2F7' }}>{label}</div>
      <div className="px-3 py-2 text-sm whitespace-pre-wrap break-words" style={{ color: '#1F2937' }}>{value || '—'}</div>
    </div>
  );
}

function CaseReport({ item, token, projectName, backHref }: { item: ReportCase; token: string; projectName: string; backHref?: string }) {
  const status = resultStyle[item.testResult || ''] || { color: '#475569', background: '#E2E8F0' };
  const log = sanitizeReportHtml(item.testLog, id => `/api/reports/${encodeURIComponent(token)}/files/${id}`);
  return (
    <article className="min-h-full bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: '#E5E7EB', backgroundColor: 'rgba(255,255,255,.96)', backdropFilter: 'blur(8px)' }}>
        <div>
          <div className="text-xs" style={{ color: '#888' }}>{item.moduleName} / {item.feature || '未填写特性'}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <h1 className="text-lg font-bold" style={{ color: '#1A1A1A' }}>{caseTitle(item)}</h1>
            <span className="px-2 py-0.5 rounded text-xs font-semibold" style={status}>{item.testResult || '未执行'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ReportDownloadButton href={`/api/reports/${encodeURIComponent(token)}/download`} compact />
          {backHref && <a href={backHref} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-blue-50" style={{ borderColor: '#B3D9FF', color: '#0073E6' }}>← 返回报告汇总</a>}
        </div>
      </div>

      <div className="p-5">
        <section className="grid grid-cols-1 md:grid-cols-2 overflow-hidden rounded-lg border mb-3" style={{ borderColor: '#D1D5DB' }}>
          <ReadonlyRow label="项目" value={projectName} /><ReadonlyRow label="特性" value={item.feature} />
          <ReadonlyRow label="测试类别" value={item.testCategory} /><ReadonlyRow label="特征" value={item.trait} />
          <ReadonlyRow label="编号" value={item.caseNo} /><ReadonlyRow label="用例名称" value={item.caseName} />
          <ReadonlyRow label="灯光" value={item.light} /><ReadonlyRow label="温度" value={item.temperature} />
          <ReadonlyRow label="测试环境" value={item.testEnv} full />
          <ReadonlyRow label="前置操作" value={item.preOperation} full />
          <ReadonlyRow label="测试步骤" value={item.step} full />
          <ReadonlyRow label="预期结果" value={item.expectResult} full />
          <ReadonlyRow label="备注" value={item.note} full />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 overflow-hidden rounded-lg border mb-4" style={{ borderColor: '#D1D5DB', backgroundColor: '#FAFBFC' }}>
          <ReadonlyRow label="测试设备" value={item.testDevice} full />
          <ReadonlyRow label="测试结果" value={item.testResult || '未执行'} />
          <div className="grid grid-cols-[88px_1fr] border-t" style={{ borderColor: '#EEF2F7' }}>
            <div className="px-3 py-2 text-xs font-medium" style={{ color: '#6B7280', backgroundColor: '#F5F5F5', borderRight: '1px solid #EEF2F7' }}>JIRA链接</div>
            <div className="px-3 py-2 min-w-0">{item.jiraLinks.some(isHttpJiraLink) ? item.jiraLinks.filter(isHttpJiraLink).map(link => <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="block truncate text-sm hover:underline" style={{ color: '#0073E6' }}>{link}</a>) : <span>—</span>}</div>
          </div>
          <ReadonlyRow label="测试备注" value={item.testResultNote} full />
          <ReadonlyRow label="测试者" value={item.testerName} /><ReadonlyRow label="优先级" value={item.priority} />
        </section>

        <section className="rounded-lg border p-4 mb-4" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
          <div className="flex items-center gap-2 mb-3"><span className="w-1 h-4 rounded-full" style={{ backgroundColor: '#8B5CF6' }} /><h2 className="text-sm font-semibold">测试过程及日志</h2>{log && <span className="ml-auto text-[11px]" style={{ color: '#94A3B8' }}>双击图片可放大查看</span>}</div>
          {log ? <ReportLogViewer html={log} className="report-log rounded-md border bg-white px-3 py-2 text-sm leading-7 overflow-auto" style={{ borderColor: '#EEEEEE', minHeight: '150px' }} /> : <div className="rounded-md border bg-white px-3 py-8 text-center text-sm" style={{ borderColor: '#EEEEEE', color: '#94A3B8' }}>暂无执行记录</div>}
          {item.files.some(file => file.source !== 'editor') && <div className="mt-3 space-y-1">{item.files.filter(file => file.source !== 'editor').map(file => <a key={file.id} href={`/api/reports/${encodeURIComponent(token)}/files/${file.id}`} className="block rounded border bg-white px-3 py-1.5 text-xs hover:bg-blue-50" style={{ borderColor: '#E5E7EB', color: '#0073E6' }}>{file.originalName} · {(file.fileSize / 1024).toFixed(1)} KB</a>)}</div>}
        </section>
      </div>
    </article>
  );
}

function ReportSummary({ cases, token, filter }: { cases: ReportCase[]; token: string; filter?: string }) {
  const categoryOf = (item: ReportCase) => {
    const category = item.testCategory.trim();
    if (category === 'Stress Test' || category === 'FW Stress Test') return 'stress';
    if (category === 'Function Test' || category === 'FW Function Test') return 'function';
    return 'other';
  };
  const categories = [
    { key: 'function', title: '功能测试进度汇总', label: '功能用例' },
    { key: 'stress', title: '压测测试进度汇总', label: '压测用例' },
    { key: 'other', title: '其他测试进度汇总', label: '其他用例' },
  ].map(category => {
    const categoryCases = cases.filter(item => categoryOf(item) === category.key);
    const features = new Map<string, ReportCase[]>();
    for (const item of categoryCases) {
      const name = item.moduleName.trim() || '未命名特性';
      features.set(name, [...(features.get(name) || []), item]);
    }
    return { ...category, cases: categoryCases, features, stats: getStats(categoryCases) };
  }).filter(category => category.cases.length > 0 && (!filter || category.cases.some(item => item.testResult === 'Fail')));

  return (
    <section>
      <div className="flex items-center justify-between mb-3"><div><h2 className="text-sm font-semibold">项目进度汇总</h2><p className="text-xs mt-1" style={{ color: '#64748B' }}>与平台项目页一致：先查看分类汇总，点击特性后才显示具体 Case。</p></div><span className="rounded border bg-white px-2 py-1 text-xs" style={{ borderColor: '#CBD5E1', color: '#475569' }}>查看全部特性</span></div>
      <div className="space-y-5">
      {categories.map(category => (
        <section key={category.key} className="rounded-xl border p-4 shadow-sm" style={{ borderColor: '#BFDBFE', background: 'linear-gradient(135deg, #EFF6FF 0%, #FFFFFF 72%)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#2563EB', boxShadow: '0 0 0 4px #DBEAFE' }} /><h3 className="text-sm font-semibold">{category.title}</h3><span className="rounded-full px-2 py-0.5 text-[11px]" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>{category.label}</span></div>
            <span className="rounded-full border bg-white px-2.5 py-1 text-xs font-semibold" style={{ borderColor: '#BFDBFE', color: '#2563EB' }}>完成率 {category.stats.rate}%</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
            {[['总用例', category.stats.total, '#0F172A'], ['已完成', category.stats.completed, '#2563EB'], ['未完成', category.stats.total - category.stats.completed, '#475569'], ['完成情况', `${category.stats.completed}/${category.stats.total}`, '#0F172A']].map(([label, value, color]) => <div key={String(label)} className="rounded-lg border bg-white px-3 py-2" style={{ borderColor: '#BFDBFE' }}><div className="text-[11px]" style={{ color: '#64748B' }}>{label}</div><strong className="text-lg" style={{ color: String(color) }}>{value}</strong></div>)}
          </div>
          <div className="flex items-center justify-between mt-3 text-[11px]" style={{ color: '#64748B' }}><span>整体进度</span><span>{category.stats.rate}%</span></div>
          <div className="h-3 rounded-full mt-1 overflow-hidden" style={{ backgroundColor: '#DBEAFE' }}><div className="h-full rounded-full" style={{ width: `${category.stats.rate}%`, background: 'linear-gradient(90deg,#93C5FD,#2563EB)' }} /></div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-4">
            {Array.from(category.features, ([name, items]) => ({ name, items, stats: getStats(items) })).filter(feature => !filter || feature.items.some(item => item.testResult === 'Fail')).map(feature => (
              <details key={feature.name} className="group rounded-md border bg-white overflow-hidden" style={{ borderColor: '#E2E8F0' }}>
                <summary className="cursor-pointer list-none px-3 py-2 hover:bg-blue-50">
                  <div className="flex items-center gap-2"><span className="text-[10px] group-open:rotate-90 transition-transform" style={{ color: '#64748B' }}>▶</span><strong className="text-xs truncate flex-1">{feature.name}</strong><span className="text-[11px]" style={{ color: '#64748B' }}>完成 {feature.stats.completed}/{feature.stats.total}</span><span className="rounded px-2 py-0.5 text-[11px]" style={{ backgroundColor: '#F1F5F9', color: '#334155' }}>{feature.stats.rate}%</span></div>
                  <div className="h-1.5 rounded mt-2 overflow-hidden" style={{ backgroundColor: '#E2E8F0' }}><div className="h-full rounded" style={{ width: `${feature.stats.rate}%`, backgroundColor: feature.stats.rate === 100 ? '#16A34A' : '#2563EB' }} /></div>
                </summary>
                <div className="border-t p-2 space-y-1" style={{ borderColor: '#E2E8F0', backgroundColor: '#F8FBFF' }}>
                  {feature.items.filter(item => !filter || item.testResult === 'Fail').map(item => <a key={item.id} href={`/report/${encodeURIComponent(token)}?case=${item.id}${filter ? `&filter=${filter}` : ''}`} className="flex items-center gap-2 rounded bg-white px-2 py-2 hover:bg-blue-50"><span className="px-1.5 py-0.5 rounded text-[11px] flex-shrink-0" style={resultStyle[item.testResult || ''] || { color: '#475569', background: '#E2E8F0' }}>{item.testResult || '未执行'}</span><span className="text-xs truncate flex-1">{caseTitle(item)}</span><span className="hidden sm:block text-[11px]" style={{ color: '#64748B' }}>{item.testerName}</span><span style={{ color: '#2563EB' }}>›</span></a>)}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
      </div>
      {cases.length === 0 && <div className="rounded-lg border bg-white p-10 text-center text-sm" style={{ color: '#94A3B8', borderColor: '#DDE3EA' }}>此范围暂无 Case</div>}
    </section>
  );
}

export default async function PublicReportPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ case?: string; filter?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  const payload = await resolveReportPayload(token);
  if (!payload) notFound();
  const requestedCaseId = Number(query.case || 0) || undefined;
  const report = loadReportData(payload, requestedCaseId);
  if (!report) notFound();
  const s = report.summary;
  const failedOnly = query.filter === 'fail';
  const baseHref = `/report/${encodeURIComponent(token)}${failedOnly ? '?filter=fail' : ''}`;
  const jiraIssues = report.selectedCase ? [] : await fetchJiraIssues(report.jiraLinks.filter(item => isHttpJiraLink(item.link)).map(item => item.link));
  const testerCount = new Set(report.cases.map(item => item.testerName).filter(name => name && name !== '未分配')).size;
  const cards = [['用例总数', s.total, '#334155'], ['已完成', s.completed, '#2563EB'], ['通过', s.passed, '#16A34A'], ['失败', s.failed, '#DC2626'], ['阻塞', s.blocked, '#D97706'], ['完成率', `${s.completionRate}%`, '#7C3AED']];

  return (
    <main className="h-[100dvh] overflow-hidden flex flex-col" style={{ backgroundColor: '#F4F7FB', color: '#1F2937' }}>
      {report.selectedCase ? <div className="flex-1 overflow-auto"><CaseReport item={report.selectedCase} token={token} projectName={report.project.name} backHref={report.scope === 'case' ? undefined : baseHref} /></div> : <>
        <header className="flex-shrink-0 bg-white border-b px-5 py-3" style={{ borderColor: '#DCE3EA', borderTop: '4px solid #1677FF' }}>
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-[11px] font-semibold" style={{ color: '#1677FF' }}>CASE SYSTEM · 只读测试报告</div><div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-bold">{report.project.name}</h1><span className="rounded px-2 py-0.5 text-[11px]" style={{ backgroundColor: '#EEF6FF', color: '#0369A1' }}>{testerCount} 位执行者</span><span className="rounded border px-2 py-0.5 text-[11px]" style={{ borderColor: '#0073E6', backgroundColor: '#F0F7FF', color: '#0073E6' }}>项目进度</span></div><div className="text-xs" style={{ color: '#64748B' }}>{report.scopeLabel} · {report.project.startDate && report.project.endDate ? `${report.project.startDate} ~ ${report.project.endDate}` : '未设置项目日期'} · 生成者：{report.generatedBy}</div></div>
            <ReportDownloadButton href={`/api/reports/${encodeURIComponent(token)}/download`} />
          </div>
        </header>
        <div className="flex-1 overflow-auto"><div className="max-w-6xl mx-auto px-4 py-5">
          <section className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3 mb-5">
            <div className="bg-white border rounded-xl p-4 flex items-center gap-4" style={{ borderColor: '#DCE3EA' }}><div className="relative h-28 w-28 rounded-full flex-shrink-0" style={{ background: `conic-gradient(#16A34A 0 ${s.total ? s.passed / s.total * 100 : 0}%, #DC2626 0 ${s.total ? (s.passed + s.failed) / s.total * 100 : 0}%, #D97706 0 ${s.total ? (s.passed + s.failed + s.blocked) / s.total * 100 : 0}%, #E2E8F0 0)` }}><div className="absolute inset-4 rounded-full bg-white flex flex-col items-center justify-center"><strong className="text-xl">{s.completionRate}%</strong><span className="text-[10px]" style={{ color: '#64748B' }}>完成率</span></div></div><div className="text-xs space-y-2"><div><i className="inline-block w-2 h-2 rounded-full mr-1 bg-green-600" />通过 {s.passed}</div><div><i className="inline-block w-2 h-2 rounded-full mr-1 bg-red-600" />失败 {s.failed}</div><div><i className="inline-block w-2 h-2 rounded-full mr-1 bg-amber-600" />阻塞 {s.blocked}</div></div></div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{cards.map(([label, value, color]) => <div key={String(label)} className="bg-white border rounded-lg p-3 text-center" style={{ borderColor: '#DCE3EA' }}><strong className="block text-xl" style={{ color: String(color) }}>{value}</strong><span className="text-xs" style={{ color: '#64748B' }}>{label}</span></div>)}</div>
          </section>
          <div className="flex justify-end mb-4">{failedOnly ? <a href={`/report/${encodeURIComponent(token)}`} className="rounded border px-3 py-1.5 text-xs bg-white" style={{ borderColor: '#CBD5E1', color: '#475569' }}>查看全部用例</a> : <a href={`/report/${encodeURIComponent(token)}?filter=fail`} className="rounded px-3 py-1.5 text-xs text-white" style={{ backgroundColor: '#DC2626' }}>一键查看失败用例（{s.failed}）</a>}</div>
          {(report.project.archivedAt || report.project.archiveNote) && <section className="rounded-lg border bg-white px-4 py-3 mb-5 text-xs" style={{ borderColor: '#DCE3EA', color: '#64748B' }}>归档时间：{report.project.archivedAt || '—'}　归档人：{report.project.archivedBy || '—'}{report.project.archiveNote ? `　备注：${report.project.archiveNote}` : ''}</section>}
          {jiraIssues.length > 0 && <section className="mt-5"><div className="flex items-center gap-2 mb-3"><h2 className="text-sm font-semibold">JIRA 汇总</h2><span className="rounded-full bg-slate-100 px-2 text-xs">{jiraIssues.length}</span></div><div className="grid grid-cols-1 xl:grid-cols-2 gap-3">{jiraIssues.map(issue => <article key={issue.link} className="rounded-lg border bg-white p-3" style={{ borderColor: issue.isDone ? '#BBF7D0' : '#FED7AA' }}><div className="flex flex-wrap items-center gap-2 text-xs"><a href={issue.link} target="_blank" rel="noopener noreferrer" className="font-bold hover:underline" style={{ color: '#DC2626' }}>【{issue.issueKey}】</a><span className="rounded px-1.5 py-0.5" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>{issue.issueType}</span><span className="rounded px-1.5 py-0.5" style={{ backgroundColor: issue.isDone ? '#DCFCE7' : '#FEF3C7', color: issue.isDone ? '#166534' : '#92400E' }}>{issue.statusCategory}</span><span className="ml-auto rounded px-2 py-0.5" style={{ backgroundColor: '#FFF7ED', color: '#C2410C' }}>{issue.priority}</span></div><div className="font-medium text-sm mt-2 leading-6">{issue.summary}</div><div className="text-[11px] mt-2" style={{ color: '#64748B' }}>项目：{issue.projectName}　状态：{issue.statusName}　经办：{issue.assigneeName}　提单：{issue.reporterName}{issue.updated ? `　更新：${issue.updated.slice(0, 10)}` : ''}</div></article>)}</div></section>}
          <div className="mt-5">{failedOnly && s.failed === 0 ? <div className="rounded-lg border bg-white p-10 text-center text-sm" style={{ borderColor: '#DCE3EA', color: '#64748B' }}>当前没有失败用例</div> : <ReportSummary cases={report.cases} token={token} filter={failedOnly ? 'fail' : undefined} />}</div>
          <footer className="text-center text-xs py-6" style={{ color: '#94A3B8' }}>只读归档报告 · 无编辑入口</footer>
        </div></div>
      </>}
    </main>
  );
}
