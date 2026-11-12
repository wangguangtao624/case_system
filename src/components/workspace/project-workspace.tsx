'use client';

import { useState, useMemo, useEffect } from 'react';
import { Cpu, Layers3, Wrench, Plus, ArrowUpRight, Search, SlidersHorizontal, FolderOpen, CheckCircle2, CircleDashed, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TEST_TYPES, TEST_TYPE_LABELS, groupProjects, suggestClassification, type TestType } from '@/lib/project-classification';

export interface WorkspaceProject {
  id: string; dbId: number; name: string; testType?: TestType; chipModel?: string;
  firmwareVersion?: string; publishStatus?: string; isArchived?: boolean;
  children?: WorkspaceProject[]; testResult?: string | null; type?: string;
}
export type TypeFilter = TestType | 'all';
const icons = { firmware: Layers3, chip: Cpu, tool: Wrench };
export function TypeTabs({ value, onChange, projects, compact = false }: {
  value: TypeFilter; onChange: (value: TypeFilter) => void; projects: WorkspaceProject[]; compact?: boolean;
}) {
  return <div className={compact ? 'type-tabs compact' : 'type-tabs'} aria-label="测试类型">
    {(['all', ...TEST_TYPES] as const).map(type => {
      const Icon = type === 'all' ? FolderOpen : icons[type];
      const count = projects.filter(p => type === 'all' || (p.testType || 'firmware') === type).length;
      return <button key={type} onClick={() => onChange(type)} aria-pressed={value === type} className={value === type ? 'active' : ''}>
        {!compact && <Icon size={16} />}<span>{type === 'all' ? '全部测试' : TEST_TYPE_LABELS[type]}</span><small>{count}</small>
      </button>;
    })}
  </div>;
}
export function projectCounts(project: WorkspaceProject): { total: number; passed: number; failed: number; blocked: number; completed: number } {
  if (project.type === 'case') return { total: 1, passed: +(project.testResult === 'Pass'), failed: +(project.testResult === 'Fail'), blocked: +(['Block', 'Blocked'].includes(project.testResult || '')), completed: +(['Pass', 'Fail'].includes(project.testResult || '')) };
  return (project.children || []).reduce((sum, child) => {
    const counts = projectCounts(child);
    return { total: sum.total + counts.total, passed: sum.passed + counts.passed, failed: sum.failed + counts.failed, blocked: sum.blocked + counts.blocked, completed: sum.completed + counts.completed };
  }, { total: 0, passed: 0, failed: 0, blocked: 0, completed: 0 });
}
export function ProjectWorkspace({ projects, filter, onFilter, onOpen, onEdit, onCreate, isManager, scopeLabel }: {
  projects: WorkspaceProject[]; filter: TypeFilter; onFilter: (value: TypeFilter) => void;
  onOpen: (id: number) => void; onEdit: (project: WorkspaceProject) => void; onCreate: () => void; isManager: boolean; scopeLabel: string;
}) {
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState('all');
  useEffect(() => setChip('all'), [filter]);
  const typed = projects.filter(p => filter === 'all' || (p.testType || 'firmware') === filter);
  const chips = [...new Set(typed.map(p => p.chipModel).filter(Boolean))].sort() as string[];
  const visible = typed.filter(p => (chip === 'all' || p.chipModel === chip) && `${p.name} ${p.chipModel || ''} ${p.firmwareVersion || ''}`.toLowerCase().includes(search.toLowerCase()));
  const groups = groupProjects(visible);
  const counts = useMemo(() => projects.filter(p => filter === 'all' || (p.testType || 'firmware') === filter).reduce((acc, p) => { const c = projectCounts(p); return { total: acc.total + c.total, completed: acc.completed + c.completed, failed: acc.failed + c.failed, blocked: acc.blocked + c.blocked }; }, { total: 0, completed: 0, failed: 0, blocked: 0 }), [projects, filter]);
  return <div className="workspace-home">
    <div className="workspace-eyebrow">QUALITY WORKSPACE <span>/</span> 测试管理</div>
    <div className="workspace-title-row"><div><h1>测试工作台</h1><p>围绕芯片组织测试，让每个版本的质量进展清晰可见。</p></div>
      {isManager && <button className="workspace-primary" onClick={onCreate}><Plus size={16} />新建测试项目</button>}
    </div>
    <div className="workspace-metrics">
      {[{ label: '测试项目', value: typed.length, icon: FolderOpen, note: scopeLabel }, { label: '用例总数', value: counts.total, icon: Layers3, note: '当前项目范围' }, { label: '已完成', value: counts.completed, icon: CheckCircle2, note: counts.total ? `${Math.round(counts.completed / counts.total * 100)}% 完成率` : '等待开始测试' }, { label: '需关注', value: counts.failed + counts.blocked, icon: CircleDashed, note: `${counts.failed} 失败 · ${counts.blocked} 阻塞` }].map(item => <div className="workspace-metric" key={item.label}><div><span>{item.label}</span><item.icon size={17}/></div><strong>{item.value.toLocaleString()}</strong><small>{item.note}</small></div>)}
    </div>
    <div className="workspace-projects">
      <div className="workspace-section-title"><div><h2>项目目录</h2><p>固件按所属芯片分组，芯片功能与工具测试独立管理</p></div><span className="workspace-scope">{scopeLabel}</span></div>
      <TypeTabs value={filter} onChange={value => { setChip('all'); onFilter(value); }} projects={projects}/>
      <div className="workspace-toolbar"><label className="workspace-search"><Search size={16}/><input aria-label="搜索项目、芯片或版本" placeholder="搜索项目、芯片型号或固件版本…" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button aria-label="清空搜索" onClick={() => setSearch('')}><X size={14}/></button>}</label><select aria-label="按芯片筛选" value={chip} onChange={e => setChip(e.target.value)}><option value="all">全部芯片</option>{chips.map(c => <option key={c}>{c}</option>)}</select><span>{visible.length} 个项目</span></div>
      {groups.map(group => {
        const Icon = icons[group.type];
        return <section key={group.key} className="workspace-group"><div className="workspace-group-title"><span className={`type-icon ${group.type}`}><Icon size={17}/></span><h3>{group.chip || '工具测试'}</h3><span>{TEST_TYPE_LABELS[group.type]}</span><small>{group.projects.length} 个项目</small></div>
          <div className="workspace-card-grid">{group.projects.map(p => {
            const c = projectCounts(p); const progress = c.total ? Math.round(c.completed / c.total * 100) : 0;
            return <article className="workspace-project-card" key={p.id}><div className="workspace-card-top"><span className={`workspace-status ${p.isArchived ? 'archived' : p.publishStatus === 'draft' ? 'draft' : ''}`}>{p.isArchived ? '已归档' : p.publishStatus === 'draft' ? '未发布' : '进行中'}</span>{isManager && <button title="项目设置" aria-label={`编辑项目 ${p.name}`} onClick={() => onEdit(p)}><SlidersHorizontal size={15}/></button>}</div>
              <button className="workspace-card-link" onClick={() => onOpen(p.dbId)}><h4>{p.name}</h4><ArrowUpRight size={17}/></button>
              <p className="workspace-card-version">{group.type === 'firmware' ? p.firmwareVersion || '版本待补充' : group.type === 'chip' ? '芯片基础功能验证' : '工具功能与兼容性验证'}</p>
              <div className="workspace-progress-label"><span>{c.total} 条用例</span><span>已完成 {progress}%</span></div><div className="workspace-progress"><i style={{ width: `${progress}%` }}/></div>
              <div className="workspace-card-bottom"><span><i className="pass"/>{c.passed} 通过</span><span><i className="fail"/>{c.failed} 失败</span><span><i className="block"/>{c.blocked} 阻塞</span></div>
            </article>;
          })}</div>
        </section>;
      })}
      {!visible.length && <div className="workspace-empty"><FolderOpen size={36}/><h3>{search || chip !== 'all' ? '没有匹配的项目' : '这里还没有测试项目'}</h3><p>{search || chip !== 'all' ? '尝试其他名称或调整筛选条件。' : '选择其他项目状态，或创建一个测试项目开始工作。'}</p>{isManager && !search && <button className="workspace-primary" onClick={onCreate}><Plus size={15}/>新建测试项目</button>}</div>}
    </div>
  </div>;
}

export function ProjectEditor({ project, defaultType, chips, onClose, onSaved }: {
  project: WorkspaceProject | null; defaultType: TypeFilter; chips: string[]; onClose: () => void;
  onSaved: (id: number, type: TestType, created: boolean) => void;
}) {
  const [name, setName] = useState(project?.name || '');
  const [type, setType] = useState<TestType>(project?.testType || (defaultType === 'all' ? 'firmware' : defaultType));
  const [chip, setChip] = useState(project?.chipModel || '');
  const [version, setVersion] = useState(project?.firmwareVersion || '');
  const [knownChips, setKnownChips] = useState(chips);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/projects', { signal: controller.signal }).then(r => r.json()).then(data => {
      if (Array.isArray(data.projects)) setKnownChips([...new Set([...chips, ...data.projects.map((p: { chip_model?: string }) => p.chip_model).filter(Boolean)])].sort() as string[]);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const suggestion = suggestClassification(name);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch('/api/projects', { method: project ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: project?.dbId, name, test_type: type, chip_model: type === 'tool' ? '' : chip, firmware_version: type === 'firmware' ? version : '' }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '保存失败');
      onSaved(project?.dbId || data.id, type, !project);
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="project-editor sm:max-w-[560px]">
    <DialogTitle>{project ? '项目设置' : '新建测试项目'}</DialogTitle><DialogDescription>选择测试类型和所属芯片，统一管理测试用例与执行记录。</DialogDescription>
    <form onSubmit={save}><label>测试类型</label><div className="project-type-options">{TEST_TYPES.map(t => { const Icon = icons[t]; return <button type="button" key={t} aria-pressed={type === t} className={type === t ? 'active' : ''} onClick={() => setType(t)}><Icon size={20}/>{TEST_TYPE_LABELS[t]}</button>; })}</div>
      <label htmlFor="project-name">项目名称 <em>*</em></label><input id="project-name" autoFocus required maxLength={200} value={name} placeholder={type === 'firmware' ? '例如 MAT130 V300 V4.2.5_DVP' : type === 'chip' ? '例如 MAT821 或 MAT130V300' : '例如 ISP 调试工具测试'} onChange={e => setName(e.target.value)}/>
      {name && (suggestion.chip_model || suggestion.firmware_version) && <div className="project-suggestion">识别建议：{suggestion.chip_model} {type === 'firmware' && suggestion.firmware_version}<button type="button" onClick={() => { setChip(suggestion.chip_model); if (type === 'firmware') setVersion(suggestion.firmware_version); }}>填入建议</button></div>}
      {type !== 'tool' && <><label htmlFor="chip-model">所属芯片 <em>*</em></label><input id="chip-model" list="chip-options" required maxLength={80} value={chip} onChange={e => setChip(e.target.value)} placeholder="选择已有芯片或输入新型号，如 MAT130V300"/><datalist id="chip-options">{knownChips.map(c => <option key={c} value={c}/>)}</datalist><p className="project-field-hint">相同芯片型号会自动分到一组，空格与大小写会统一处理。</p></>}
      {type === 'firmware' && <><label htmlFor="firmware-version">固件版本 <em>*</em></label><input id="firmware-version" required maxLength={120} value={version} onChange={e => setVersion(e.target.value)} placeholder="例如 V4.2.5_DVP"/></>}
      {type === 'chip' && <p className="project-info">芯片功能测试用于验证芯片基础能力，无需填写固件版本。</p>}
      {error && <p className="project-error" role="alert">{error}</p>}
      <div className="project-editor-footer"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="workspace-primary" disabled={busy} type="submit">{busy ? '保存中…' : project ? '保存设置' : '创建项目'}</button></div>
    </form>
  </DialogContent></Dialog>;
}
