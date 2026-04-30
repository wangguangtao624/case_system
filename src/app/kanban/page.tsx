'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const CHART_COLORS = {
  passed: '#22C55E',
  failed: '#EF4444',
  blocked: '#F97316',
  incomplete: '#9CA3AF',
  primary: '#0073E6',
};

interface ProjectStat {
  id: number;
  name: string;
  total: number;
  completed: number;
  incomplete: number;
  passed: number;
  failed: number;
  blocked: number;
  completionRate: number;
  passRate: number;
  blockedRate: number;
  testers: Array<{
    userId: number;
    username: string;
    total: number;
    completed: number;
    passed: number;
    failed: number;
    blocked: number;
    completionRate: number;
    passRate: number;
  }>;
}

interface KanbanData {
  projects: ProjectStat[];
  summary: {
    projectCount: number;
    total: number;
    completed: number;
    incomplete: number;
    passed: number;
    failed: number;
    blocked: number;
    completionRate: number;
    passRate: number;
    blockedRate: number;
  };
  allUsers: Array<{ id: number; username: string }>;
}

export default function KanbanPage() {
  const router = useRouter();
  const [data, setData] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (r.status === 401) { router.push('/login'); return null; }
      return r.json();
    }).then(userData => {
      if (!userData?.user) { router.push('/login'); return; }
      fetch('/api/stats/kanban').then(r => r.json()).then(d => {
        setData(d);
        setLoading(false);
      }).catch(() => setLoading(false));
    }).catch(() => router.push('/login'));
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderColor: '#0073E6' }}></div>
          <p style={{ color: '#666' }}>加载看板数据...</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary, projects } = data;

  const statusPieData = [
    { name: '通过', value: summary.passed, color: CHART_COLORS.passed },
    { name: '失败', value: summary.failed, color: CHART_COLORS.failed },
    { name: '阻塞', value: summary.blocked, color: CHART_COLORS.blocked },
    { name: '未完成', value: summary.incomplete, color: CHART_COLORS.incomplete },
  ].filter(d => d.value > 0);

  const projectBarData = projects.map(p => ({
    name: p.name.length > 12 ? p.name.substring(0, 12) + '...' : p.name,
    fullName: p.name,
    '通过率': p.passRate,
    '失败率': p.total > 0 ? Math.round(p.failed / p.total * 1000) / 10 : 0,
    '阻塞率': p.blockedRate,
    '未完成率': p.total > 0 ? Math.round(p.incomplete / p.total * 1000) / 10 : 0,
  }));

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F5F5F5' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-14 border-b" style={{ backgroundColor: '#FFFFFF', borderColor: '#EEEEEE' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded" style={{ backgroundColor: '#0073E6' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          <span className="font-bold text-base" style={{ color: '#333' }}>项目总看板</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F0F7FF', color: '#0073E6' }}>
            {summary.projectCount} 个进行中项目
          </span>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="px-4 py-1.5 text-sm rounded hover:bg-gray-100 transition-colors flex items-center gap-1"
          style={{ color: '#0073E6' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          返回工作台
        </button>
      </header>

      <div className="max-w-[1400px] mx-auto p-6">
        {/* Overall Summary */}
        <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: '#FFFFFF', borderColor: '#E5E7EB' }}>
          <h2 className="text-lg font-bold mb-4" style={{ color: '#1F2937' }}>总体概览</h2>
          <div className="grid grid-cols-6 gap-4 mb-6">
            <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#F0F7FF' }}>
              <div className="text-xs mb-1" style={{ color: '#6B7280' }}>总用例</div>
              <div className="text-2xl font-bold" style={{ color: '#0073E6' }}>{summary.total}</div>
            </div>
            <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#F0FFF4' }}>
              <div className="text-xs mb-1" style={{ color: '#6B7280' }}>已完成</div>
              <div className="text-2xl font-bold" style={{ color: '#22C55E' }}>{summary.completed}</div>
              <div className="text-xs" style={{ color: '#9CA3AF' }}>{summary.completionRate}%</div>
            </div>
            <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#F0FFF4' }}>
              <div className="text-xs mb-1" style={{ color: '#6B7280' }}>通过</div>
              <div className="text-2xl font-bold" style={{ color: '#10B981' }}>{summary.passed}</div>
              <div className="text-xs" style={{ color: '#9CA3AF' }}>{summary.passRate}%</div>
            </div>
            <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#FEF2F2' }}>
              <div className="text-xs mb-1" style={{ color: '#6B7280' }}>失败</div>
              <div className="text-2xl font-bold" style={{ color: '#EF4444' }}>{summary.failed}</div>
            </div>
            <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#FFF7ED' }}>
              <div className="text-xs mb-1" style={{ color: '#6B7280' }}>阻塞</div>
              <div className="text-2xl font-bold" style={{ color: '#F97316' }}>{summary.blocked}</div>
            </div>
            <div className="rounded-lg p-4 text-center" style={{ backgroundColor: '#F3F4F6' }}>
              <div className="text-xs mb-1" style={{ color: '#6B7280' }}>未完成</div>
              <div className="text-2xl font-bold" style={{ color: '#9CA3AF' }}>{summary.incomplete}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="rounded-lg border p-4" style={{ borderColor: '#E5E7EB' }}>
              <h4 className="text-sm font-semibold mb-3" style={{ color: '#374151' }}>用例状态分布</h4>
              {statusPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={statusPieData} cx="50%" cy="50%" outerRadius={80} innerRadius={45} dataKey="value" label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(1)}%`} labelLine={false}>
                      {statusPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[220px] text-xs" style={{ color: '#9CA3AF' }}>暂无数据</div>
              )}
            </div>
            <div className="rounded-lg border p-4" style={{ borderColor: '#E5E7EB' }}>
              <h4 className="text-sm font-semibold mb-3" style={{ color: '#374151' }}>各项目完成率对比</h4>
              {projects.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={projectBarData} layout="vertical" margin={{ left: 10, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} interval={0} />
                    <Tooltip formatter={(value: number, name: string) => [`${value}%`, name]} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="通过率" stackId="a" fill="#22C55E" barSize={14} />
                    <Bar dataKey="失败率" stackId="a" fill="#EF4444" barSize={14} />
                    <Bar dataKey="阻塞率" stackId="a" fill="#F97316" barSize={14} />
                    <Bar dataKey="未完成率" stackId="a" fill="#9CA3AF" barSize={14} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[220px] text-xs" style={{ color: '#9CA3AF' }}>暂无进行中项目</div>
              )}
            </div>
          </div>
        </div>

        {/* Project Cards */}
        <h2 className="text-lg font-bold mb-4" style={{ color: '#1F2937' }}>项目进度详情</h2>
        <div className="grid grid-cols-1 gap-4">
          {projects.map(project => (
            <div key={project.id} className="rounded-xl border" style={{ backgroundColor: '#FFFFFF', borderColor: '#E5E7EB' }}>
              {/* Project Header */}
              <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}
              >
                <div className="flex items-center gap-3">
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"
                    style={{ transform: expandedProject === project.id ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span className="font-bold text-sm" style={{ color: '#1F2937' }}>{project.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: project.completionRate >= 80 ? '#F0FFF4' : project.completionRate >= 50 ? '#FFFBEB' : '#FEF2F2', color: project.completionRate >= 80 ? '#16A34A' : project.completionRate >= 50 ? '#D97706' : '#DC2626' }}>
                    完成率 {project.completionRate}%
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs" style={{ color: '#6B7280' }}>
                  <span>总用例 <b style={{ color: '#333' }}>{project.total}</b></span>
                  <span>通过 <b style={{ color: '#22C55E' }}>{project.passed}</b></span>
                  <span>失败 <b style={{ color: '#EF4444' }}>{project.failed}</b></span>
                  <span>阻塞 <b style={{ color: '#F97316' }}>{project.blocked}</b></span>
                  <span>未完成 <b style={{ color: '#9CA3AF' }}>{project.incomplete}</b></span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="px-5 pb-2">
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden flex">
                  {project.total > 0 && (
                    <>
                      <div className="h-full" style={{ width: `${(project.passed / project.total) * 100}%`, backgroundColor: '#22C55E' }} />
                      <div className="h-full" style={{ width: `${(project.failed / project.total) * 100}%`, backgroundColor: '#EF4444' }} />
                      <div className="h-full" style={{ width: `${(project.blocked / project.total) * 100}%`, backgroundColor: '#F97316' }} />
                    </>
                  )}
                </div>
              </div>

              {/* Expanded: Tester Details */}
              {expandedProject === project.id && (
                <div className="px-5 pb-4 border-t" style={{ borderColor: '#F3F4F6' }}>
                  <h4 className="text-xs font-semibold mt-3 mb-2" style={{ color: '#374151' }}>执行者进度</h4>
                  {project.testers.length > 0 ? (
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ backgroundColor: '#F9FAFB' }}>
                          <th className="text-left px-3 py-2 font-medium" style={{ color: '#6B7280' }}>执行者</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>总用例</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>已完成</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>通过</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>失败</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>阻塞</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>完成率</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>通过率</th>
                          <th className="text-left px-3 py-2 font-medium" style={{ color: '#6B7280', width: '200px' }}>进度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.testers.map(tester => (
                          <tr key={tester.userId} className="border-t" style={{ borderColor: '#F3F4F6' }}>
                            <td className="px-3 py-2 font-medium" style={{ color: '#1F2937' }}>{tester.username}</td>
                            <td className="text-center px-3 py-2" style={{ color: '#374151' }}>{tester.total}</td>
                            <td className="text-center px-3 py-2" style={{ color: '#374151' }}>{tester.completed}</td>
                            <td className="text-center px-3 py-2" style={{ color: '#22C55E' }}>{tester.passed}</td>
                            <td className="text-center px-3 py-2" style={{ color: tester.failed > 0 ? '#EF4444' : '#9CA3AF' }}>{tester.failed}</td>
                            <td className="text-center px-3 py-2" style={{ color: tester.blocked > 0 ? '#F97316' : '#9CA3AF' }}>{tester.blocked}</td>
                            <td className="text-center px-3 py-2">
                              <span style={{ color: tester.completionRate >= 80 ? '#22C55E' : tester.completionRate >= 50 ? '#F97316' : '#EF4444' }}>
                                {tester.completionRate}%
                              </span>
                            </td>
                            <td className="text-center px-3 py-2">
                              <span style={{ color: tester.passRate >= 80 ? '#22C55E' : tester.passRate >= 50 ? '#F97316' : '#EF4444' }}>
                                {tester.passRate}%
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${tester.completionRate}%`, backgroundColor: tester.completionRate >= 80 ? '#22C55E' : tester.completionRate >= 50 ? '#F97316' : '#EF4444' }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-xs py-2" style={{ color: '#9CA3AF' }}>暂未分配执行者</div>
                  )}
                </div>
              )}
            </div>
          ))}

          {projects.length === 0 && (
            <div className="text-center py-12 text-sm" style={{ color: '#9CA3AF' }}>
              暂无进行中的项目
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
