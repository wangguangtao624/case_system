import { fileDataUri, sanitizeReportHtml, type ReportCase, type ReportData } from '@/lib/report-data';
import { isHttpJiraLink } from '@/lib/jira-links';

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function textBlock(label: string, value: string) {
  if (!value) return '';
  return `<div class="field"><b>${escapeHtml(label)}</b><div>${escapeHtml(value).replace(/\n/g, '<br>')}</div></div>`;
}

function caseHtml(item: ReportCase) {
  const imageMap = new Map(item.files.map(file => [file.id, fileDataUri(file)]));
  const log = sanitizeReportHtml(item.testLog, fileId => imageMap.get(fileId) || '#missing-image');
  const safeJiraLinks = item.jiraLinks.filter(isHttpJiraLink);
  const jira = safeJiraLinks.length
    ? safeJiraLinks.map(link => `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a>`).join('<br>')
    : '<span class="muted">无</span>';
  const files = item.files.filter(file => file.source !== 'editor').map(file => `<li>${escapeHtml(file.originalName)} (${Math.round(file.fileSize / 1024)} KB)</li>`).join('');
  return `<details class="case" id="case-${item.id}">
    <summary><span class="status ${escapeHtml((item.testResult || 'none').toLowerCase())}">${escapeHtml(item.testResult || '未执行')}</span> ${escapeHtml([item.caseNo, item.caseName].filter(Boolean).join(' '))}</summary>
    <div class="meta">模块：${escapeHtml(item.moduleName)}　特性：${escapeHtml(item.feature || '未填写')}　优先级：${escapeHtml(item.priority)}　测试者：${escapeHtml(item.testerName)}</div>
    <div class="grid">${textBlock('测试类别', item.testCategory)}${textBlock('特征', item.trait)}${textBlock('测试环境', item.testEnv)}${textBlock('测试设备', item.testDevice)}${textBlock('灯光', item.light)}${textBlock('温度', item.temperature)}</div>
    ${textBlock('前置操作', item.preOperation)}${textBlock('测试步骤', item.step)}${textBlock('预期结果', item.expectResult)}${textBlock('备注', item.note)}${textBlock('测试备注', item.testResultNote)}
    <div class="field"><b>JIRA 问题单</b><div>${jira}</div></div>
    <div class="field"><b>测试执行过程</b><div class="log">${log || '<span class="muted">暂无执行记录</span>'}</div></div>
    ${files ? `<div class="field"><b>附件清单</b><ul>${files}</ul><div class="muted">离线报告保留附件名称；执行日志中的截图已内嵌。</div></div>` : ''}
  </details>`;
}

export function buildOfflineReportHtml(report: ReportData): string {
  const s = report.summary;
  const jira = report.jiraLinks.filter(item => isHttpJiraLink(item.link)).map(item => `<li><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.link)}</a>（${item.caseIds.length} 个 Case）</li>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.project.name)} - 测试报告</title>
  <style>
  *{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#1f2937;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1180px;margin:auto;padding:28px}.hero,.panel,.case{background:#fff;border:1px solid #dfe5ec;border-radius:12px;box-shadow:0 2px 8px #0f172a0a}.hero{padding:24px;margin-bottom:16px;border-top:5px solid #1677ff}h1{margin:0 0 6px;font-size:26px}.muted,.meta{color:#64748b}.cards{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin:16px 0}.card{background:#fff;border:1px solid #dfe5ec;border-radius:9px;padding:12px;text-align:center}.card strong{display:block;font-size:22px}.panel{padding:18px;margin:16px 0}.case{margin:10px 0;overflow:hidden}.case summary{cursor:pointer;padding:14px 16px;font-weight:600}.case[open] summary{border-bottom:1px solid #e5e7eb}.case>div{margin:12px 16px}.status{display:inline-block;min-width:58px;text-align:center;border-radius:12px;padding:1px 8px;margin-right:8px;background:#e5e7eb}.status.pass{background:#dcfce7;color:#166534}.status.fail{background:#fee2e2;color:#991b1b}.status.block{background:#ffedd5;color:#9a3412}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field{border-top:1px solid #eef2f7;padding:10px 0}.field b{display:block;color:#475569;margin-bottom:3px}.log{overflow:auto}.log img{max-width:100%!important;height:auto!important}.log table{max-width:100%;border-collapse:collapse}a{color:#0969da;word-break:break-all}ul{padding-left:20px}@media(max-width:800px){main{padding:12px}.cards{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}@media print{body{background:#fff}main{max-width:none;padding:0}.hero,.panel,.case{box-shadow:none}details{break-inside:avoid}details>*{display:block!important}}
  </style></head><body><main>
  <section class="hero"><h1>${escapeHtml(report.project.name)}</h1><div>${escapeHtml(report.scopeLabel)}测试报告 · 生成者：${escapeHtml(report.generatedBy)} · 导出时间：${escapeHtml(new Date().toLocaleString('zh-CN'))}</div><div class="muted">归档时间：${escapeHtml(report.project.archivedAt || '未记录')}　归档人：${escapeHtml(report.project.archivedBy || '未记录')}</div>${report.project.archiveNote ? `<p>${escapeHtml(report.project.archiveNote)}</p>` : ''}</section>
  <section class="cards"><div class="card"><strong>${s.total}</strong>总数</div><div class="card"><strong>${s.completed}</strong>已完成</div><div class="card"><strong>${s.incomplete}</strong>未完成</div><div class="card"><strong>${s.passed}</strong>通过</div><div class="card"><strong>${s.failed}</strong>失败</div><div class="card"><strong>${s.blocked}</strong>阻塞</div><div class="card"><strong>${s.completionRate}%</strong>完成率</div></section>
  <section class="panel"><h2>JIRA 问题单汇总</h2>${jira ? `<ul>${jira}</ul>` : '<div class="muted">暂无关联 JIRA 问题单</div>'}</section>
  <section><h2>测试用例与执行过程</h2>${report.cases.map(caseHtml).join('')}</section>
  </main></body></html>`;
}
