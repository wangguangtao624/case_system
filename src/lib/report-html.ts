import { fileDataUri, sanitizeReportHtml, type ReportCase, type ReportData } from '@/lib/report-data';
import { isHttpJiraLink } from '@/lib/jira-links';

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function caseTitle(item: ReportCase) {
  return [item.caseNo, item.caseName].filter(Boolean).join(' ') || '未命名 Case';
}

function fieldRow(label: string, value: string, full = false) {
  return `<div class="field-row${full ? ' full' : ''}"><b>${escapeHtml(label)}</b><div>${escapeHtml(value || '—').replace(/\n/g, '<br>')}</div></div>`;
}

function stats(items: ReportCase[]) {
  const passed = items.filter(item => item.testResult === 'Pass').length;
  const failed = items.filter(item => item.testResult === 'Fail').length;
  const blocked = items.filter(item => item.testResult === 'Block').length;
  const completed = passed + failed + blocked;
  return { passed, failed, completed, rate: items.length ? Math.round(completed / items.length * 1000) / 10 : 0 };
}

export interface OfflineReportOptions {
  attachmentHref?: (item: ReportCase, file: ReportCase['files'][number]) => string | null;
}

function caseHtml(item: ReportCase, showBack: boolean, projectName: string, options: OfflineReportOptions) {
  // 只编码日志真正引用的图片，避免普通图片附件或无关文件扩大离线报告与峰值内存。
  const referencedIds = new Set(Array.from(item.testLog.matchAll(/\/api\/files\/(?:preview\/)?(\d+)/gi), match => Number(match[1])));
  const imageMap = new Map<number, string | null>();
  for (const file of item.files) {
    if (referencedIds.has(file.id)) imageMap.set(file.id, fileDataUri(file));
  }
  const log = sanitizeReportHtml(item.testLog, fileId => imageMap.get(fileId) || '#missing-image');
  const jira = item.jiraLinks.filter(isHttpJiraLink).map(link => `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a>`).join('<br>') || '—';
  const files = item.files.filter(file => file.source !== 'editor').map(file => {
    const dataUri = options.attachmentHref ? options.attachmentHref(item, file) : fileDataUri(file);
    const name = escapeHtml(file.originalName);
    const size = `(${Math.round(file.fileSize / 1024)} KB)`;
    if (!dataUri) return `<li style="display:flex;gap:8px;padding:6px 2px;color:#64748b"><span>${name}</span><small style="margin-left:auto;color:#94a3b8">${size} · 原文件已不存在，无法嵌入</small></li>`;
    let localPath = file.originalName;
    try {
      if (!dataUri.startsWith('data:')) localPath = decodeURIComponent(dataUri);
    } catch {
      // 保留文件名作为兜底，避免异常编码影响整份报告生成。
    }
    return `<li style="padding:7px 2px;border-bottom:1px solid #f1f5f9"><div style="display:flex;align-items:center;gap:8px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155">${name}</span><small style="color:#94a3b8;white-space:nowrap;margin-left:auto">${size} · 请从附件目录打开</small></div><code style="display:block;margin-top:3px;color:#64748b;font-size:11px;overflow-wrap:anywhere">路径：${escapeHtml(localPath)}</code></li>`;
  }).join('');
  const resultClass = (item.testResult || 'none').toLowerCase();

  return `<article class="case-view view" id="case-${item.id}">
    <header class="case-head"><div><small>${escapeHtml(item.moduleName)} / ${escapeHtml(item.feature || '未填写特性')}</small><h1>${escapeHtml(caseTitle(item))} <span class="status ${escapeHtml(resultClass)}">${escapeHtml(item.testResult || '未执行')}</span></h1></div>${showBack ? '<button class="back" type="button">← 返回报告汇总</button>' : ''}</header>
    <div class="case-body">
      <section class="fields">${fieldRow('项目', projectName)}${fieldRow('特性', item.feature)}${fieldRow('测试类别', item.testCategory)}${fieldRow('特征', item.trait)}${fieldRow('编号', item.caseNo)}${fieldRow('用例名称', item.caseName)}${fieldRow('灯光', item.light)}${fieldRow('温度', item.temperature)}${fieldRow('测试环境', item.testEnv, true)}${fieldRow('前置操作', item.preOperation, true)}${fieldRow('测试步骤', item.step, true)}${fieldRow('预期结果', item.expectResult, true)}${fieldRow('备注', item.note, true)}</section>
      <section class="fields result-fields">${fieldRow('测试设备', item.testDevice, true)}${fieldRow('测试结果', item.testResult || '未执行')}<div class="field-row"><b>JIRA链接</b><div>${jira}</div></div>${fieldRow('测试备注', item.testResultNote, true)}${fieldRow('测试者', item.testerName)}${fieldRow('优先级', item.priority)}</section>
      <section class="log-panel"><h2><i></i>测试过程及日志${log ? '<span>双击图片可放大查看</span>' : ''}</h2><div class="log">${log || '<div class="empty">暂无执行记录</div>'}</div>${files ? `<div style="margin-top:10px;color:#64748b;font-size:11px">离线附件 · 请按显示路径到附件目录打开</div><ul class="files" style="margin-top:4px;padding:4px 12px;list-style:none">${files}</ul>` : ''}</section>
    </div>
  </article>`;
}

function summaryHtml(report: ReportData) {
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
  ].map(category => ({ ...category, cases: report.cases.filter(item => categoryOf(item) === category.key) })).filter(category => category.cases.length > 0);
  const categoryHtml = categories.map(category => {
    const categoryStats = stats(category.cases);
    const features = new Map<string, ReportCase[]>();
    for (const item of category.cases) {
      const name = item.moduleName.trim() || '未命名特性';
      features.set(name, [...(features.get(name) || []), item]);
    }
    const featureHtml = Array.from(features, ([name, items]) => ({ name, items, stats: stats(items) })).map(feature => `<details class="feature">
      <summary><div class="feature-title"><span class="arrow">▶</span><strong>${escapeHtml(feature.name)}</strong></div><div class="feature-stats"><span>完成 ${feature.stats.completed}/${feature.items.length}</span><b>${feature.stats.rate}%</b></div><div class="progress"><i style="width:${feature.stats.rate}%"></i></div></summary>
      <div class="case-list">${feature.items.map(item => `<button type="button" data-case="${item.id}" data-result="${escapeHtml((item.testResult || 'none').toLowerCase())}"><span class="status ${(item.testResult || 'none').toLowerCase()}">${escapeHtml(item.testResult || '未执行')}</span><span class="case-title">${escapeHtml(caseTitle(item))}</span><small>${escapeHtml(item.testerName)}</small><b>›</b></button>`).join('')}</div>
    </details>`).join('');
    return `<section class="category-panel"><div class="category-head"><div><i></i><strong>${category.title}</strong><em>${category.label}</em></div><b>完成率 ${categoryStats.rate}%</b></div><div class="category-cards"><div><small>总用例</small><b>${category.cases.length}</b></div><div><small>已完成</small><b>${categoryStats.completed}</b></div><div><small>未完成</small><b>${category.cases.length - categoryStats.completed}</b></div><div><small>完成情况</small><b>${categoryStats.completed}/${category.cases.length}</b></div></div><div class="overall"><span>整体进度</span><span>${categoryStats.rate}%</span></div><div class="category-progress"><i style="width:${categoryStats.rate}%"></i></div><div class="feature-grid">${featureHtml}</div></section>`;
  }).join('');
  const s = report.summary;
  const jira = (report.jiraIssues || []).map(issue => `<article class="jira-card ${issue.isDone ? 'done' : ''}"><div><a href="${escapeHtml(issue.link)}" target="_blank" rel="noopener noreferrer"><b>【${escapeHtml(issue.issueKey)}】</b></a><em>${escapeHtml(issue.issueType)}</em><em>${escapeHtml(issue.statusCategory)}</em><span>${escapeHtml(issue.priority)}</span></div><strong>${escapeHtml(issue.summary)}</strong><small>项目：${escapeHtml(issue.projectName)}　状态：${escapeHtml(issue.statusName)}　经办：${escapeHtml(issue.assigneeName)}　提单：${escapeHtml(issue.reporterName)}${issue.updated ? `　更新：${escapeHtml(issue.updated.slice(0, 10))}` : ''}</small></article>`).join('');
  return `<section id="summary" class="view active"><header class="topbar"><div><small>CASE SYSTEM · 离线只读测试报告</small><h1>${escapeHtml(report.project.name)}</h1><p>${escapeHtml(report.scopeLabel)} · ${escapeHtml(report.project.startDate && report.project.endDate ? `${report.project.startDate} ~ ${report.project.endDate}` : '未设置项目日期')} · 生成者：${escapeHtml(report.generatedBy)}</p></div><span class="offline">已离线保存</span></header>
    <div class="summary-body"><div class="overview"><div class="donut" style="--pass:${s.total ? s.passed / s.total * 360 : 0}deg;--fail:${s.total ? (s.passed + s.failed) / s.total * 360 : 0}deg;--block:${s.total ? (s.passed + s.failed + s.blocked) / s.total * 360 : 0}deg"><i><b>${s.completionRate}%</b><span>完成率</span></i></div><div class="cards"><div><b>${s.total}</b><span>用例总数</span></div><div><b>${s.completed}</b><span>已完成</span></div><div><b class="green">${s.passed}</b><span>通过</span></div><div><b class="red">${s.failed}</b><span>失败</span></div><div><b class="orange">${s.blocked}</b><span>阻塞</span></div><div><b class="purple">${s.completionRate}%</b><span>完成率</span></div></div></div><div class="filter-actions"><button type="button" data-filter="fail">一键查看失败用例（${s.failed}）</button><button type="button" data-filter="all" hidden>查看全部用例</button></div>
    ${(report.project.archivedAt || report.project.archiveNote) ? `<div class="archive">归档时间：${escapeHtml(report.project.archivedAt || '—')}　归档人：${escapeHtml(report.project.archivedBy || '—')}${report.project.archiveNote ? `　备注：${escapeHtml(report.project.archiveNote)}` : ''}</div>` : ''}
    ${jira ? `<section class="jira"><h2>JIRA 问题单汇总（${report.jiraIssues?.length || 0}）</h2><div class="jira-grid">${jira}</div></section>` : ''}<div class="section-title"><div><h2>项目进度汇总</h2><p>先查看分类汇总，点击特性后才显示具体 Case。</p></div><span>查看全部特性</span></div>${categoryHtml || '<div class="empty panel">此范围暂无 Case</div>'}</div>
  </section>`;
}

const CASES_MARKER = '<!--__REPORT_CASES_STREAM__-->';

function buildOfflineReportShell(report: ReportData): string {
  const hasSummary = report.scope !== 'case';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.project.name)} - 测试报告</title><style>
  *{box-sizing:border-box}html,body{height:100%;overflow:hidden}body{margin:0;background:#f4f7fb;color:#1f2937;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.view{display:none;height:100%;overflow:auto}.view.active{display:block}.topbar,.case-head{position:sticky;top:0;z-index:10;background:#fffffff5;backdrop-filter:blur(8px);border-bottom:1px solid #dce3ea;padding:14px max(20px,calc((100% - 1120px)/2));display:flex;align-items:center;justify-content:space-between;gap:16px}.topbar{border-top:4px solid #1677ff}.topbar small{font-weight:700;color:#1677ff}.topbar h1,.case-head h1{font-size:19px;margin:0}.topbar p,.case-head small{margin:0;color:#64748b;font-size:12px}.offline{background:#ecfdf5;color:#047857;border-radius:8px;padding:7px 12px;font-size:12px}.summary-body{max-width:1120px;margin:auto;padding:20px}.overview{display:grid;grid-template-columns:180px 1fr;gap:12px;margin-bottom:12px}.donut{width:150px;height:150px;margin:auto;border-radius:50%;background:conic-gradient(#16a34a 0 var(--pass),#dc2626 var(--pass) var(--fail),#d97706 var(--fail) var(--block),#e2e8f0 var(--block));padding:22px}.donut i{width:100%;height:100%;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-style:normal}.donut b{font-size:22px}.donut span{font-size:11px;color:#64748b}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.cards>div{background:#fff;border:1px solid #dce3ea;border-radius:9px;padding:10px;text-align:center}.cards b{display:block;font-size:21px;color:#334155}.cards span{font-size:12px;color:#64748b}.filter-actions{text-align:right;margin-bottom:14px}.filter-actions button{border:0;border-radius:6px;background:#dc2626;color:#fff;padding:7px 12px;cursor:pointer}.filter-actions button[data-filter=all]{background:#fff;color:#475569;border:1px solid #cbd5e1}.green{color:#16a34a!important}.red{color:#dc2626!important}.orange{color:#d97706!important}.purple{color:#7c3aed!important}.archive,.panel{background:#fff;border:1px solid #dce3ea;border-radius:8px;padding:11px 14px;margin-bottom:18px;color:#64748b;font-size:12px}.section-title{display:flex;align-items:center;justify-content:space-between;margin:8px 0 12px}.section-title h2{font-size:15px;margin:0}.section-title p{font-size:12px;color:#64748b;margin:2px 0}.section-title>span{font-size:12px;color:#64748b}.feature,.jira{background:#fff;border:1px solid #dde3ea;border-radius:9px;overflow:hidden;margin:10px 0}.feature summary{cursor:pointer;list-style:none;padding:12px 15px}.feature summary::-webkit-details-marker{display:none}.feature-title,.feature-stats{display:flex;align-items:center;gap:12px}.feature summary>div:first-child{float:left}.feature-stats{justify-content:flex-end;color:#64748b;font-size:12px}.feature-title em{font-style:normal;font-size:11px;color:#1d4ed8;background:#dbeafe;border-radius:4px;padding:1px 7px}.feature[open] .arrow{display:inline-block;transform:rotate(90deg)}.feature-stats b{color:#2563eb}.pass-text{color:#16a34a}.fail-text{color:#dc2626}.progress{clear:both;height:6px!important;background:#e2e8f0;border-radius:9px;margin-top:9px;overflow:hidden}.progress i{display:block;height:100%;background:#2563eb}.case-list{border-top:1px solid #e5e7eb}.case-list button{width:100%;border:0;border-bottom:1px solid #eef2f7;background:#fff;padding:10px 20px;display:flex;align-items:center;gap:12px;text-align:left;cursor:pointer}.case-list button:hover{background:#eff6ff}.case-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.case-list small{color:#64748b}.jira{padding:14px}.jira h2{font-size:14px;margin:0 0 10px}.jira-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.jira-card{border:1px solid #fed7aa;border-radius:8px;padding:10px}.jira-card.done{border-color:#bbf7d0}.jira-card>div{display:flex;gap:7px;align-items:center}.jira-card em{font-style:normal;font-size:11px;background:#fee2e2;color:#dc2626;border-radius:4px;padding:1px 5px}.jira-card>div span{margin-left:auto;font-size:11px;color:#c2410c}.jira-card>strong,.jira-card>small{display:block;margin-top:7px}.jira-card>small{color:#64748b}.status{display:inline-block;min-width:58px;text-align:center;border-radius:12px;padding:1px 8px;font-size:12px;background:#e2e8f0}.status.pass{background:#dcfce7;color:#166534}.status.fail{background:#fee2e2;color:#991b1b}.status.block{background:#ffedd5;color:#9a3412}.case-head{padding:14px 20px}.case-head h1 .status{vertical-align:2px;margin-left:6px}.back{border:1px solid #b3d9ff;color:#0073e6;background:#fff;border-radius:6px;padding:7px 12px;cursor:pointer}.back:hover{background:#eff6ff}.case-body{padding:20px}.fields{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;margin-bottom:12px}.result-fields{background:#fafbfc}.field-row{display:grid;grid-template-columns:88px 1fr;border-top:1px solid #eef2f7;min-width:0}.field-row.full{grid-column:span 2}.field-row b{padding:8px 12px;background:#fafbfc;border-right:1px solid #eef2f7;color:#6b7280;font-size:12px}.field-row>div{padding:8px 12px;white-space:normal;overflow-wrap:anywhere}.field-row a,a{color:#0969da}.log-panel{border:1px solid #e5e7eb;background:#fafbfc;border-radius:8px;padding:16px}.log-panel h2{font-size:14px;margin:0 0 12px}.log-panel h2 i{display:inline-block;width:4px;height:16px;background:#8b5cf6;border-radius:4px;vertical-align:-3px;margin-right:8px}.log-panel h2 span{float:right;color:#94a3b8;font-size:11px;font-weight:400}.log{background:#fff;border:1px solid #eee;border-radius:6px;padding:8px 12px;min-height:150px;overflow:auto}.log img{max-width:45%!important;height:auto!important;display:inline-block!important;vertical-align:bottom!important;margin:2px 4px;cursor:zoom-in}.log table{max-width:100%;border-collapse:collapse}.files{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:8px 30px;margin:10px 0 0}.files span,.empty{color:#94a3b8}.empty{text-align:center;padding:30px}.image-viewer[hidden]{display:none}.image-viewer{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000000e0;backdrop-filter:blur(3px)}.image-viewer img{max-width:90vw;max-height:84vh;object-fit:contain;user-select:none;transform-origin:center;transition:transform .15s ease}.viewer-meta{position:absolute;left:20px;top:16px;z-index:2;color:#ffffffe6;font-size:13px}.viewer-meta small{display:block;color:#ffffff99;margin-top:2px}.viewer-actions{position:absolute;right:16px;top:16px;z-index:2;display:flex;align-items:center;gap:8px}.viewer-actions button{border:0;background:transparent;color:#fff;border-radius:999px;height:36px;min-width:36px;padding:0 10px;font-size:15px;cursor:pointer}.viewer-actions button:hover{background:#ffffff26}.viewer-zoom{min-width:54px;text-align:center;color:#fff}.viewer-hint{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:2;color:#ffffff99;font-size:12px;white-space:nowrap}
  .category-panel{border:1px solid #bfdbfe;border-radius:12px;padding:16px;margin:0 0 18px;background:linear-gradient(135deg,#eff6ff 0%,#fff 72%);box-shadow:0 8px 18px #0f172a0a}.category-head,.category-head>div,.overall{display:flex;align-items:center;justify-content:space-between;gap:10px}.category-head i{width:10px;height:10px;border-radius:50%;background:#2563eb;box-shadow:0 0 0 4px #dbeafe}.category-head em{font-style:normal;font-size:11px;color:#1d4ed8;background:#dbeafe;border-radius:12px;padding:1px 8px}.category-head>b{font-size:12px;color:#2563eb;background:#fff;border:1px solid #bfdbfe;border-radius:14px;padding:3px 10px}.category-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.category-cards>div{background:#fff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 12px}.category-cards small{display:block;color:#64748b}.category-cards b{font-size:17px}.overall{font-size:11px;color:#64748b}.category-progress{height:12px;background:#dbeafe;border-radius:12px;overflow:hidden;margin-top:4px}.category-progress i{display:block;height:100%;background:linear-gradient(90deg,#93c5fd,#2563eb)}.feature-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.feature-grid .feature{margin:0;align-self:start}
  @media(max-width:700px){.overview{grid-template-columns:1fr}.cards{grid-template-columns:repeat(2,1fr)}.jira-grid{grid-template-columns:1fr}.category-cards{grid-template-columns:repeat(2,1fr)}.feature-grid{grid-template-columns:1fr}.feature-stats{display:none}.case-list small{display:none}.fields{grid-template-columns:1fr}.field-row.full{grid-column:span 1}.log img{max-width:100%!important}.topbar,.case-head{padding-left:12px;padding-right:12px}.summary-body,.case-body{padding:12px}}
  @media print{html,body{height:auto;overflow:visible}.view{height:auto;overflow:visible}.topbar,.case-head{position:static}.back,.image-viewer{display:none!important}.feature{break-inside:avoid}.view:not(.active){display:none!important}}
  </style></head><body>${hasSummary ? summaryHtml(report) : ''}${CASES_MARKER}<div class="image-viewer" role="dialog" aria-modal="true" aria-label="图片预览" hidden><div class="viewer-meta"><strong>报告图片</strong><small></small></div><div class="viewer-actions"><button type="button" data-viewer="in" title="放大">＋</button><span class="viewer-zoom">100%</span><button type="button" data-viewer="out" title="缩小">－</button><button type="button" data-viewer="reset" title="重置">1:1</button><button type="button" data-viewer="close" title="关闭">×</button></div><div class="viewer-hint">滚轮缩放 | 拖拽移动 | Esc 或点击空白处关闭</div><img alt="报告图片" draggable="false"></div><script>
  (()=>{
    const views=[...document.querySelectorAll('.view')];
    const show=id=>{views.forEach(v=>v.classList.toggle('active',v.id===id));document.getElementById(id)?.scrollTo(0,0);location.hash=id==='summary'?'':'#'+id};
    const filter=mode=>{document.querySelectorAll('.feature').forEach(feature=>{let visible=0;feature.querySelectorAll('[data-result]').forEach(button=>{const shown=mode==='all'||button.dataset.result==='fail';button.hidden=!shown;if(shown)visible++});feature.hidden=visible===0;if(mode==='fail'&&visible)feature.open=true});document.querySelector('[data-filter=fail]').hidden=mode==='fail';document.querySelector('[data-filter=all]').hidden=mode!=='fail'};
    const viewer=document.querySelector('.image-viewer');
    const viewerImage=viewer.querySelector('img');
    const viewerName=viewer.querySelector('.viewer-meta strong');
    const viewerSize=viewer.querySelector('.viewer-meta small');
    const viewerZoom=viewer.querySelector('.viewer-zoom');
    let zoom=1,posX=0,posY=0,dragging=false,startX=0,startY=0;
    const render=()=>{viewerZoom.textContent=Math.round(zoom*100)+'%';viewerImage.style.transform='scale('+zoom+') translate('+(posX/zoom)+'px,'+(posY/zoom)+'px)';viewerImage.style.cursor=zoom>1?(dragging?'grabbing':'grab'):'zoom-in';viewerImage.style.transition=dragging?'none':'transform .15s ease'};
    const setZoom=value=>{zoom=Math.min(5,Math.max(.2,value));if(zoom<=1){posX=0;posY=0}render()};
    const reset=()=>{zoom=1;posX=0;posY=0;dragging=false;render()};
    const open=image=>{viewerImage.src=image.src;viewerImage.alt=image.alt||image.title||'报告图片';viewerName.textContent=viewerImage.alt;viewerSize.textContent='';reset();viewer.hidden=false};
    const close=()=>{viewer.hidden=true;viewerImage.removeAttribute('src');dragging=false};
    viewerImage.addEventListener('load',()=>{viewerSize.textContent='原始尺寸：'+viewerImage.naturalWidth+' × '+viewerImage.naturalHeight+'px'});
    viewer.addEventListener('wheel',event=>{event.preventDefault();setZoom(zoom+(event.deltaY>0?-.12:.12))},{passive:false});
    viewerImage.addEventListener('mousedown',event=>{if(zoom<=1)return;event.preventDefault();dragging=true;startX=event.clientX-posX;startY=event.clientY-posY;render()});
    viewerImage.addEventListener('dblclick',event=>{event.stopPropagation();setZoom(zoom===1?2:1)});
    document.addEventListener('mousemove',event=>{if(!dragging)return;posX=event.clientX-startX;posY=event.clientY-startY;render()});
    document.addEventListener('mouseup',()=>{if(dragging){dragging=false;render()}});
    document.addEventListener('dblclick',event=>{const image=event.target.closest?.('.log img');if(image){event.preventDefault();open(image)}});
    document.addEventListener('click',event=>{const button=event.target.closest?.('[data-case]');if(button)show('case-'+button.dataset.case);if(event.target.closest?.('.back'))show('summary');const filterButton=event.target.closest?.('[data-filter]');if(filterButton)filter(filterButton.dataset.filter);const action=event.target.closest?.('[data-viewer]')?.dataset.viewer;if(action==='in')setZoom(zoom+.25);if(action==='out')setZoom(zoom-.25);if(action==='reset')reset();if(action==='close'||event.target===viewer)close()});
    document.addEventListener('keydown',event=>{if(viewer.hidden)return;if(event.key==='Escape')close();if(event.key==='+'||event.key==='=')setZoom(zoom+.25);if(event.key==='-')setZoom(zoom-.25);if(event.key==='0')reset()});
    window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(id&&document.getElementById(id))show(id);else if(${hasSummary})show('summary')});
    const initial=location.hash.slice(1);show(initial&&document.getElementById(initial)?initial:${hasSummary ? "'summary'" : `'case-${report.cases[0]?.id || 0}'`});
  })();
  </script></body></html>`;
}

export function* buildOfflineReportHtmlParts(report: ReportData, options: OfflineReportOptions = {}): Generator<string> {
  const shell = buildOfflineReportShell(report);
  const markerIndex = shell.indexOf(CASES_MARKER);
  yield shell.slice(0, markerIndex);
  const showBack = report.scope !== 'case';
  for (const item of report.cases) yield caseHtml(item, showBack, report.project.name, options);
  yield shell.slice(markerIndex + CASES_MARKER.length);
}

export function estimateOfflineReportBytes(report: ReportData): number {
  let bytes = Buffer.byteLength(buildOfflineReportShell(report), 'utf8');
  for (const item of report.cases) {
    bytes += Buffer.byteLength(item.testLog, 'utf8') + 4096;
    const referencedIds = new Set(Array.from(item.testLog.matchAll(/\/api\/files\/(?:preview\/)?(\d+)/gi), match => Number(match[1])));
    for (const file of item.files) {
      if (referencedIds.has(file.id)) bytes += 4 * Math.ceil(file.fileSize / 3);
      if (file.source !== 'editor') bytes += 4 * Math.ceil(file.fileSize / 3);
    }
  }
  return bytes;
}

export function buildOfflineReportHtml(report: ReportData): string {
  return Array.from(buildOfflineReportHtmlParts(report)).join('');
}
