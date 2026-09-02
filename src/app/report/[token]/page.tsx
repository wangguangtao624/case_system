import { notFound } from 'next/navigation';
import { verifyReportToken } from '@/lib/auth';
import { isHttpJiraLink } from '@/lib/jira-links';
import { loadReportData, sanitizeReportHtml, type ReportCase } from '@/lib/report-data';

export const metadata = { robots: { index: false, follow: false } };

const resultStyle: Record<string, { color: string; background: string }> = {
  Pass: { color: '#166534', background: '#DCFCE7' },
  Fail: { color: '#991B1B', background: '#FEE2E2' },
  Block: { color: '#9A3412', background: '#FFEDD5' },
};

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="border-t py-3" style={{ borderColor: '#EEF2F7' }}>
      <div className="text-xs font-semibold mb-1" style={{ color: '#64748B' }}>{label}</div>
      <div className="text-sm whitespace-pre-wrap" style={{ color: '#1F2937' }}>{value || '—'}</div>
    </div>
  );
}

function CaseReport({ item, token }: { item: ReportCase; token: string }) {
  const status = resultStyle[item.testResult || ''] || { color: '#475569', background: '#E2E8F0' };
  const log = sanitizeReportHtml(item.testLog, id => `/api/reports/${encodeURIComponent(token)}/files/${id}`);
  return (
    <section className="bg-white border rounded-xl shadow-sm p-5 mt-5" style={{ borderColor: '#DCE3EA' }}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs" style={{ color: '#64748B' }}>{item.moduleName} / {item.feature || '未填写特性'}</div>
          <h2 className="text-xl font-bold mt-1">{[item.caseNo, item.caseName].filter(Boolean).join(' ')}</h2>
        </div>
        <span className="px-3 py-1 rounded-full text-sm font-semibold" style={status}>{item.testResult || '未执行'}</span>
      </div>
      <div className="grid md:grid-cols-2 gap-x-6">
        <Field label="测试者" value={item.testerName} /><Field label="优先级" value={item.priority} />
        <Field label="测试类别" value={item.testCategory} /><Field label="特征" value={item.trait} />
        <Field label="测试环境" value={item.testEnv} /><Field label="测试设备" value={item.testDevice} />
        <Field label="灯光" value={item.light} /><Field label="温度" value={item.temperature} />
      </div>
      <Field label="前置操作" value={item.preOperation} />
      <Field label="测试步骤" value={item.step} />
      <Field label="预期结果" value={item.expectResult} />
      <Field label="备注" value={item.note} />
      <Field label="测试备注" value={item.testResultNote} />
      <div className="border-t py-3" style={{ borderColor: '#EEF2F7' }}>
        <div className="text-xs font-semibold mb-1" style={{ color: '#64748B' }}>JIRA 问题单</div>
        {item.jiraLinks.length ? item.jiraLinks.map(link => isHttpJiraLink(link) ? <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="block text-sm hover:underline break-all" style={{ color: '#0969DA' }}>{link}</a> : null) : <span>—</span>}
      </div>
      <div className="border-t py-3" style={{ borderColor: '#EEF2F7' }}>
        <div className="text-sm font-semibold mb-2">测试执行过程</div>
        {log ? <div className="report-log text-sm leading-7 overflow-auto" dangerouslySetInnerHTML={{ __html: log }} /> : <div className="text-sm" style={{ color: '#94A3B8' }}>暂无执行记录</div>}
      </div>
      {item.files.some(file => file.source !== 'editor') && (
        <div className="border-t py-3" style={{ borderColor: '#EEF2F7' }}>
          <div className="text-sm font-semibold mb-2">附件</div>
          {item.files.filter(file => file.source !== 'editor').map(file => <a key={file.id} href={`/api/reports/${encodeURIComponent(token)}/files/${file.id}`} className="block text-sm hover:underline" style={{ color: '#0969DA' }}>{file.originalName}</a>)}
        </div>
      )}
    </section>
  );
}

export default async function PublicReportPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ case?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  const payload = await verifyReportToken(token);
  if (!payload) notFound();
  const requestedCaseId = Number(query.case || 0) || undefined;
  const report = loadReportData(payload, requestedCaseId);
  if (!report) notFound();
  const s = report.summary;
  const cards = [['用例总数', s.total, '#334155'], ['已完成', s.completed, '#2563EB'], ['通过', s.passed, '#16A34A'], ['失败', s.failed, '#DC2626'], ['阻塞', s.blocked, '#D97706'], ['完成率', `${s.completionRate}%`, '#7C3AED']];

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#F4F7FB', color: '#1F2937' }}>
      <div className="max-w-6xl mx-auto px-4 py-7">
        <header className="bg-white border rounded-xl shadow-sm p-6" style={{ borderColor: '#DCE3EA', borderTop: '5px solid #1677FF' }}>
          <div className="flex flex-wrap justify-between gap-4">
            <div><div className="text-xs font-semibold" style={{ color: '#1677FF' }}>CASE SYSTEM · 只读测试报告</div><h1 className="text-2xl font-bold mt-1">{report.project.name}</h1><div className="text-sm mt-1" style={{ color: '#64748B' }}>{report.scopeLabel} · 生成者：{report.generatedBy}</div></div>
            <div className="flex items-start gap-2"><a href={`/api/reports/${encodeURIComponent(token)}/download`} className="px-4 py-2 rounded-lg text-sm text-white" style={{ backgroundColor: '#1677FF' }}>下载离线报告</a></div>
          </div>
          {(report.project.archivedAt || report.project.archiveNote) && <div className="text-xs mt-4" style={{ color: '#64748B' }}>归档时间：{report.project.archivedAt || '—'}　归档人：{report.project.archivedBy || '—'}{report.project.archiveNote ? `　备注：${report.project.archiveNote}` : ''}</div>}
        </header>

        <section className="grid grid-cols-2 md:grid-cols-6 gap-3 my-5">{cards.map(([label, value, color]) => <div key={String(label)} className="bg-white border rounded-lg p-3 text-center" style={{ borderColor: '#DCE3EA' }}><strong className="block text-xl" style={{ color: String(color) }}>{value}</strong><span className="text-xs" style={{ color: '#64748B' }}>{label}</span></div>)}</section>

        {report.selectedCase && <>{report.scope !== 'case' && <a href={`/report/${encodeURIComponent(token)}`} className="inline-block text-sm hover:underline" style={{ color: '#0969DA' }}>← 返回报告汇总</a>}<CaseReport item={report.selectedCase} token={token} /></>}

        {!report.selectedCase && <>
          <section className="bg-white border rounded-xl shadow-sm p-5 mb-5" style={{ borderColor: '#DCE3EA' }}><h2 className="font-bold mb-3">JIRA 问题单汇总</h2>{report.jiraLinks.some(item => isHttpJiraLink(item.link)) ? report.jiraLinks.filter(item => isHttpJiraLink(item.link)).map(item => <div key={item.link} className="flex flex-wrap justify-between gap-2 border-t py-2 text-sm" style={{ borderColor: '#EEF2F7' }}><a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline break-all" style={{ color: '#0969DA' }}>{item.link}</a><span style={{ color: '#64748B' }}>{item.caseIds.length} 个 Case</span></div>) : <div className="text-sm" style={{ color: '#94A3B8' }}>暂无关联 JIRA 问题单</div>}</section>
          <section className="bg-white border rounded-xl shadow-sm p-5" style={{ borderColor: '#DCE3EA' }}><h2 className="font-bold mb-3">测试用例</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr style={{ color: '#64748B', backgroundColor: '#F8FAFC' }}><th className="text-left p-2">模块 / 特性</th><th className="text-left p-2">Case</th><th className="text-left p-2">测试者</th><th className="text-left p-2">结果</th></tr></thead><tbody>{report.cases.map(item => <tr key={item.id} className="border-t" style={{ borderColor: '#EEF2F7' }}><td className="p-2">{item.moduleName}<div className="text-xs" style={{ color: '#64748B' }}>{item.feature || '未填写特性'}</div></td><td className="p-2"><a href={`/report/${encodeURIComponent(token)}?case=${item.id}`} className="hover:underline" style={{ color: '#0969DA' }}>{[item.caseNo, item.caseName].filter(Boolean).join(' ')}</a></td><td className="p-2">{item.testerName}</td><td className="p-2"><span className="px-2 py-0.5 rounded-full text-xs" style={resultStyle[item.testResult || ''] || { color: '#475569', background: '#E2E8F0' }}>{item.testResult || '未执行'}</span></td></tr>)}</tbody></table></div></section>
        </>}
        <footer className="text-center text-xs py-6" style={{ color: '#94A3B8' }}>此页面为只读测试报告，不提供任何编辑入口。</footer>
      </div>
    </main>
  );
}
