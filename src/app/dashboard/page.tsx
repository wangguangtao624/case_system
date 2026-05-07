'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

// Global type declarations
declare global {
  interface Window {
    __ioMenuPos?: { x: number; y: number };
  }
}
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// ============ Permission Constants ============
const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

// ============ Types ============
interface UserInfo {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

interface TreeNode {
  id: string;
  type: 'project' | 'module' | 'case';
  dbId: number;
  name: string;
  caseNo?: string;
  testResult?: string | null;
  projectId?: number;
  moduleId?: number;
  children?: TreeNode[];
  testerId?: number;
  testerName?: string;
  resolvedTesterNames?: string;
  isArchived?: boolean;
}

interface CaseData {
  id: number;
  case_name: string;
  case_no: string;
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
  fail_note: string;
  test_log: string;
  executor: string;
  test_result_note: string;
  light: string;
  temperature: string;
  module_name: string;
  module_id: number;
  project_name: string;
  project_id: number;
  is_archived?: number;
}

interface FileData {
  id: number;
  filename: string;
  original_name: string;
  file_size: number;
  file_type: string;
  created_at: string;
  source?: string;
}

interface UserItem {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

interface CasePermissions {
  isManager: boolean;
  isAssignedTester: boolean;
  canEditCore: boolean;
  canEditResult: boolean;
}

interface CaseTester {
  id: number;
  name: string;
  assignmentLevel: string;
}

interface KanbanTesterStat {
  userId: number;
  username: string;
  total: number;
  completed: number;
  incomplete: number;
  passed: number;
  failed: number;
  blocked: number;
  completionRate: number;
  passRate: number;
  modules: KanbanModuleStat[];
}

interface KanbanModuleStat {
  key: string;
  moduleId: number;
  moduleName: string;
  total: number;
  completed: number;
  passed: number;
  failed: number;
  blocked: number;
  incomplete: number;
  completionRate: number;
  passRate: number;
}

interface KanbanCaseStat {
  id: number;
  caseNo: string;
  caseName: string;
  moduleId: number;
  moduleName: string;
  testerId: number;
  testerName: string;
  feature: string;
  trait: string;
  testCategory: string;
  priority: string;
  testResult: string | null;
  jiraLink: string;
}

interface KanbanProjectStat {
  id: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  total: number;
  completed: number;
  incomplete: number;
  passed: number;
  failed: number;
  blocked: number;
  completionRate: number;
  passRate: number;
  blockedRate: number;
  testers: KanbanTesterStat[];
  cases: KanbanCaseStat[];
}

interface KanbanGanttData {
  projects: KanbanProjectStat[];
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

// ============ Main Dashboard ============
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseData | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileData[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const MIN_SIDEBAR_WIDTH = 260;
  const [loading, setLoading] = useState(true);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [testerFilter, setTesterFilter] = useState<string>(''); // '' = all, 'my' = my tasks, user_id = specific
  const [projectFilter, setProjectFilter] = useState<string>('active'); // 'active', 'archived', 'all'
  const [archiveDialog, setArchiveDialog] = useState<{ projectId: number; projectName: string } | null>(null);
  const [archiveNote, setArchiveNote] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [showKanban, setShowKanban] = useState(false);
  const [kanbanData, setKanbanData] = useState<KanbanGanttData | null>(null);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  // Bug Report
  const [showBugReport, setShowBugReport] = useState(false);
  const [showBugPanel, setShowBugPanel] = useState(false);
  const [bugTitle, setBugTitle] = useState('');
  const [bugDescription, setBugDescription] = useState('');
  const [bugSubmitting, setBugSubmitting] = useState(false);
  const [bugMsg, setBugMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [bugHover, setBugHover] = useState(false);
  // Dialogs
  const [showUserMgmt, setShowUserMgmt] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState<{ fileId: number; content: string; filename: string; truncated: boolean; isImage?: boolean } | null>(null);
  const [statsPreview, setStatsPreview] = useState<{ level: 'project' | 'module'; id: number; name: string } | null>(null);

  const loadTree = useCallback(async (filterTesterId?: string, archiveFilter?: string) => {
    try {
      const params = new URLSearchParams();
      if (filterTesterId) params.set('testerId', filterTesterId);
      if (archiveFilter) params.set('archive', archiveFilter);
      const res = await fetch(`/api/tree?${params.toString()}`);
      const data = await res.json();
      if (data.tree) {
        setTree(data.tree);
      }
      if (data.isManager !== undefined) {
        setIsManager(data.isManager);
      }
      return data.tree as TreeNode[] | undefined;
    } catch (error) {
      console.error('Load tree error:', error);
      return undefined;
    }
  }, []);

  // Sidebar resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarResizeRef.current) return;
      const delta = e.clientX - sidebarResizeRef.current.startX;
      const newWidth = sidebarResizeRef.current.startWidth + delta;
      const maxWidth = Math.floor(window.innerWidth / 3);
      const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, newWidth));
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      sidebarResizeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    // Prevent text selection while resizing
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing]);

  // Fetch current user
  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => {
        if (res.status === 401) {
          router.push('/login');
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        if (data.user) {
          setUser(data.user);
          setIsManager(MANAGER_USERNAMES.includes(data.user.username));
          loadTree('', 'active');
          // Load all users for tester filter and assignment
          fetch('/api/users').then(r => r.json()).then(d => {
            if (d.users) setAllUsers(d.users);
          }).catch(() => {});
        } else {
          router.push('/login');
        }
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, []);

  const [casePermissions, setCasePermissions] = useState<CasePermissions>({ isManager: false, isAssignedTester: false, canEditCore: false, canEditResult: false });
  const [caseTester, setCaseTester] = useState<CaseTester | null>(null);

  const handleSelectCase = useCallback(async (node: TreeNode) => {
    setShowKanban(false);
    setKanbanData(null);
    setSelectedNodeId(node.id);
    try {
      const res = await fetch(`/api/cases/${node.dbId}?_t=${Date.now()}`);
      const data = await res.json();
      if (data.case) {
        setSelectedCase(data.case as CaseData);
        setSelectedFiles((data.files || []) as FileData[]);
        let permissions = data.permissions || { isManager: false, isAssignedTester: false, canEditCore: false, canEditResult: false };
        const projectNode = tree.find(p => p.dbId === (data.case as CaseData).project_id);
        if (projectNode?.isArchived) {
          permissions = { ...permissions, canEditCore: false, canEditResult: false };
        }
        setCasePermissions(permissions);
        setCaseTester(data.tester || null);
      }
    } catch (error) {
      console.error('Load case error:', error);
    }
  }, [tree]);

  const findNodeById = (nodes: TreeNode[], id: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const findCaseNodeByDbId = useCallback((nodes: TreeNode[], caseId: number): TreeNode | null => {
    for (const node of nodes) {
      if (node.type === 'case' && node.dbId === caseId) return node;
      if (node.children) {
        const found = findCaseNodeByDbId(node.children, caseId);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const findNodePathByDbId = useCallback((
    nodes: TreeNode[],
    type: TreeNode['type'],
    dbId: number,
    path: TreeNode[] = [],
  ): TreeNode[] | null => {
    for (const node of nodes) {
      const nextPath = [...path, node];
      if (node.type === type && node.dbId === dbId) return nextPath;
      if (node.children) {
        const found = findNodePathByDbId(node.children, type, dbId, nextPath);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const expandNodePath = useCallback((path: TreeNode[], includeLastNode = false) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      const nodesToExpand = includeLastNode ? path : path.slice(0, -1);
      for (const pathNode of nodesToExpand) {
        if (pathNode.type !== 'case') next.add(pathNode.id);
      }
      return next;
    });
  }, []);

  const handleNavigateTreeNode = useCallback(async (type: 'project' | 'module', dbId: number) => {
    setShowKanban(false);
    setKanbanData(null);
    setSelectedCase(null);
    let path = findNodePathByDbId(tree, type, dbId);
    if (!path) {
      setTesterFilter('');
      const freshTree = await loadTree('', projectFilter);
      path = freshTree ? findNodePathByDbId(freshTree, type, dbId) : null;
    }
    if (path) {
      setSelectedNodeId(path[path.length - 1].id);
      expandNodePath(path, true);
    } else {
      setSelectedNodeId(`${type}-${dbId}`);
    }
  }, [expandNodePath, findNodePathByDbId, loadTree, projectFilter, tree]);

  const handleOpenCaseById = useCallback(async (caseId: number) => {
    setShowKanban(false);
    setKanbanData(null);
    const matchedPath = findNodePathByDbId(tree, 'case', caseId);
    const matchedNode = matchedPath?.[matchedPath.length - 1] || findCaseNodeByDbId(tree, caseId);
    if (matchedPath) {
      expandNodePath(matchedPath);
    }
    if (matchedNode) {
      setSelectedNodeId(matchedNode.id);
    }
    try {
      const res = await fetch(`/api/cases/${caseId}?_t=${Date.now()}`);
      const data = await res.json();
      if (data.case) {
        if (!matchedPath) {
          setTesterFilter('');
          const freshTree = await loadTree('', projectFilter);
          const freshPath = freshTree ? findNodePathByDbId(freshTree, 'case', caseId) : null;
          if (freshPath) {
            expandNodePath(freshPath);
            setSelectedNodeId(freshPath[freshPath.length - 1].id);
          }
        }
        setSelectedCase(data.case as CaseData);
        setSelectedFiles((data.files || []) as FileData[]);
        let permissions = data.permissions || { isManager: false, isAssignedTester: false, canEditCore: false, canEditResult: false };
        const projectNode = tree.find(p => p.dbId === (data.case as CaseData).project_id);
        if (projectNode?.isArchived) {
          permissions = { ...permissions, canEditCore: false, canEditResult: false };
        }
        setCasePermissions(permissions);
        setCaseTester(data.tester || null);
      }
    } catch (error) {
      console.error('Load case error:', error);
    }
  }, [expandNodePath, findCaseNodeByDbId, findNodePathByDbId, loadTree, projectFilter, tree]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const handleTesterFilterChange = (value: string) => {
    setTesterFilter(value);
    setSelectedCase(null);
    setSelectedNodeId(null);
    const filterId = value === 'my' && user ? String(user.id) : value;
    loadTree(filterId || '', projectFilter);
  };

  const handleProjectFilterChange = (value: string) => {
    setProjectFilter(value);
    setSelectedCase(null);
    setSelectedNodeId(null);
    const filterId = testerFilter === 'my' && user ? String(user.id) : testerFilter;
    loadTree(filterId || '', value);
  };

  const handleArchive = async () => {
    if (!archiveDialog) return;
    setArchiving(true);
    try {
      const res = await fetch('/api/archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: archiveDialog.projectId, archiveNote }),
      });
      const data = await res.json();
      if (data.success) {
        setArchiveDialog(null);
        setArchiveNote('');
        loadTree(testerFilter === 'my' && user ? String(user.id) : testerFilter || '', projectFilter);
      } else {
        alert(data.error || '归档失败');
      }
    } catch {
      alert('归档失败');
    } finally {
      setArchiving(false);
    }
  };

  const handleDeleteArchived = async (projectId: number) => {
    if (!confirm('确定要删除此归档项目及其所有数据吗？此操作不可撤销。')) return;
    try {
      const res = await fetch(`/api/archives?projectId=${projectId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        loadTree(testerFilter === 'my' && user ? String(user.id) : testerFilter || '', projectFilter);
      } else {
        alert(data.error || '删除失败');
      }
    } catch {
      alert('删除失败');
    }
  };

  const handleBugSubmit = async () => {
    if (!bugTitle.trim()) { setBugMsg({ type: 'error', text: '请输入标题' }); return; }
    setBugSubmitting(true);
    try {
      const res = await fetch('/api/bugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: bugTitle.trim(), description: bugDescription.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setBugMsg({ type: 'success', text: '提交成功！' });
        setBugTitle('');
        setBugDescription('');
        setTimeout(() => { setShowBugReport(false); setBugMsg(null); }, 1200);
      } else {
        setBugMsg({ type: 'error', text: data.error || '提交失败' });
      }
    } catch {
      setBugMsg({ type: 'error', text: '网络错误' });
    } finally {
      setBugSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderColor: '#0073E6' }}></div>
          <p style={{ color: '#666' }}>加载中...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: '#FFFFFF' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-12 border-b" style={{ backgroundColor: '#FFFFFF', borderColor: '#EEEEEE' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded" style={{ backgroundColor: '#0073E6' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <span className="font-bold text-sm" style={{ color: '#333' }}>测试用例管理平台</span>
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <>
              <button
                onClick={() => setShowUserMgmt(true)}
                className="px-3 py-1.5 text-xs rounded hover:bg-gray-100 transition-colors"
                style={{ color: '#0073E6' }}
              >
                用户管理
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="px-3 py-1.5 text-xs rounded hover:bg-gray-100 transition-colors"
                style={{ color: '#666' }}
              >
                存储设置
              </button>
            </>
          )}
          <button
            onClick={() => setShowBugPanel(!showBugPanel)}
            className="px-3 py-1.5 text-xs rounded hover:bg-gray-100 transition-colors"
            style={{ color: '#EF4444' }}
          >
            {user.username === '王光涛' ? '问题处理' : '问题看板'}
          </button>
          <button
            onClick={() => setShowChangePwd(true)}
            className="px-3 py-1.5 text-xs rounded hover:bg-gray-100 transition-colors"
            style={{ color: '#666' }}
          >
            修改密码
          </button>
          <span className="text-xs px-2" style={{ color: '#999' }}>|</span>
          <span className="text-xs" style={{ color: '#666' }}>{user.username}</span>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs rounded hover:bg-gray-100 transition-colors"
            style={{ color: '#666' }}
          >
            退出
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className="flex-shrink-0 border-r flex flex-col overflow-hidden"
          style={{
            width: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
            backgroundColor: '#F5F5F5',
            borderColor: '#EEEEEE',
            transition: sidebarCollapsed ? 'width 0.2s ease' : (isResizing ? 'none' : 'width 0.2s ease'),
          }}
        >
          {!sidebarCollapsed && (
            <SidebarTree
              username={user.username}
              user={user}
              tree={tree}
              expandedNodes={expandedNodes}
              setExpandedNodes={setExpandedNodes}
              selectedNodeId={selectedNodeId}
              onSelectCase={handleSelectCase}
              onTreeChange={() => loadTree(testerFilter === 'my' && user ? String(user.id) : testerFilter || '', projectFilter)}
              onToggleSidebar={() => setSidebarCollapsed(true)}
              onPreview={(level, id, name) => setStatsPreview({ level, id, name })}
              isManager={isManager}
              allUsers={allUsers}
              testerFilter={testerFilter}
              onTesterFilterChange={handleTesterFilterChange}
              projectFilter={projectFilter}
              onProjectFilterChange={handleProjectFilterChange}
              onArchive={(projectId, projectName) => setArchiveDialog({ projectId, projectName })}
              onOpenKanban={() => {
                setSelectedCase(null);
                setSelectedNodeId(null);
                setShowKanban(true);
                setKanbanLoading(true);
                fetch('/api/stats/kanban')
                  .then(r => r.json())
                  .then(d => {
                    setKanbanData(d);
                    setKanbanLoading(false);
                  })
                  .catch(() => setKanbanLoading(false));
              }}
              onDeleteArchived={handleDeleteArchived}
            />
          )}
        </aside>

        {/* Resize Handle */}
        {!sidebarCollapsed && (
          <div
            onMouseDown={handleResizeStart}
            className="flex-shrink-0 group"
            style={{
              width: '8px',
              cursor: 'col-resize',
              zIndex: 10,
              marginLeft: '-4px',
              marginRight: '-4px',
              position: 'relative',
            }}
          >
            {/* Visual indicator line - shows on hover / active drag */}
            <div
              className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100"
              style={{
                width: '2px',
                height: '100%',
                backgroundColor: isResizing ? '#0073E6' : '#CCCCCC',
                transition: 'opacity 0.15s, background-color 0.15s',
              }}
            />
          </div>
        )}

        {/* Toggle button when collapsed */}
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="absolute top-14 left-2 z-10 p-1.5 rounded shadow-sm hover:bg-gray-100"
            style={{ backgroundColor: '#FFFFFF', border: '1px solid #EEEEEE' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}

        {/* Content Area */}
        <main className="flex-1 overflow-auto" style={{ backgroundColor: '#FFFFFF' }}>
          {showKanban ? (
            <GanttKanbanView
              data={kanbanData}
              loading={kanbanLoading}
              isManager={isManager}
              onClose={() => { setShowKanban(false); setKanbanData(null); }}
              onNavigateCase={handleOpenCaseById}
              onNavigateTreeNode={handleNavigateTreeNode}
              onRefresh={() => {
                setKanbanLoading(true);
                fetch('/api/stats/kanban')
                  .then(r => r.json())
                  .then(d => { setKanbanData(d); setKanbanLoading(false); })
                  .catch(() => setKanbanLoading(false));
              }}
            />
          ) : selectedCase ? (
            <CaseDetail
              caseData={selectedCase}
              files={selectedFiles}
              permissions={casePermissions}
              tester={caseTester}
              isManager={isManager}
              allUsers={allUsers}
              onAssignTester={(caseId: number, userId: number) => {
                // Assign tester via API then refresh
                fetch('/api/assignments', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ level: 'case', targetId: caseId, userId }),
                }).then(r => r.json()).then(data => {
                  if (data.success) {
                    // Reload case to get updated tester info
                    loadTree(testerFilter === 'my' && user ? String(user.id) : testerFilter);
                    // Reload case detail
                    fetch(`/api/cases/${selectedCase.id}?_t=${Date.now()}`)
                      .then(r => r.json())
                      .then(d => {
                        if (d.case) setSelectedCase(d.case as CaseData);
                        if (d.files) setSelectedFiles(d.files as FileData[]);
                        if (d.permissions) setCasePermissions(d.permissions as CasePermissions);
                        if (d.tester) setCaseTester(d.tester as CaseTester);
                        else setCaseTester(null);
                      });
                  }
                }).catch(() => {});
              }}
              onRemoveTesterAssignment={(caseId: number) => {
                fetch(`/api/assignments?level=case&targetId=${caseId}`, { method: 'DELETE' })
                  .then(r => r.json())
                  .then(data => {
                    if (data.success) {
                      loadTree(testerFilter === 'my' && user ? String(user.id) : testerFilter);
                      fetch(`/api/cases/${selectedCase.id}?_t=${Date.now()}`)
                        .then(r => r.json())
                        .then(d => {
                          if (d.case) setSelectedCase(d.case as CaseData);
                          if (d.files) setSelectedFiles(d.files as FileData[]);
                          if (d.permissions) setCasePermissions(d.permissions as CasePermissions);
                          if (d.tester) setCaseTester(d.tester as CaseTester);
                          else setCaseTester(null);
                        });
                    }
                  }).catch(() => {});
              }}
              onUpdate={(updatedCase) => {
                setSelectedCase(updatedCase);
                loadTree(testerFilter === 'my' && user ? String(user.id) : testerFilter); // Refresh tree to update test result icons
              }}
              onFilesChange={(files) => setSelectedFiles(files)}
              onPreviewFile={(fileId, content, filename, truncated) => {
                // If content is empty, it's an image preview (fileId tells us the preview URL)
                const isImage = !content;
                setShowPreview({ fileId, content, filename, truncated, isImage });
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full" style={{ color: '#999' }}>
              <div className="text-center">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#DDD" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <p className="text-sm">请从左侧目录选择用例查看</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Dialogs */}
      {showUserMgmt && isManager && (
        <UserManagementDialog onClose={() => { setShowUserMgmt(false); }} />
      )}
      {showChangePwd && (
        <ChangePasswordDialog onClose={() => setShowChangePwd(false)} />
      )}
      {showSettings && isManager && (
        <StorageSettingsDialog onClose={() => setShowSettings(false)} />
      )}
      {showPreview && (
        <FilePreviewDialog
          content={showPreview.content}
          filename={showPreview.filename}
          truncated={showPreview.truncated}
          fileId={showPreview.fileId}
          isImage={showPreview.isImage}
          onClose={() => setShowPreview(null)}
        />
      )}
      {statsPreview && (
        <StatsPreviewModal
          level={statsPreview.level}
          id={statsPreview.id}
          name={statsPreview.name}
          onClose={() => setStatsPreview(null)}
          onNavigateCase={(caseId: number) => {
            setStatsPreview(null);
            const node = findNodeById(tree, `case-${caseId}`);
            if (node) handleSelectCase(node);
          }}
          onNavigateModule={(moduleId: number) => {
            setStatsPreview({ level: 'module', id: moduleId, name: '' });
          }}
        />
      )}

      {/* Archive Dialog */}
      {archiveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-xl shadow-2xl w-[420px] max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b" style={{ borderColor: '#EEEEEE' }}>
              <h3 className="text-base font-bold" style={{ color: '#1F2937' }}>归档项目</h3>
              <p className="text-sm mt-1" style={{ color: '#6B7280' }}>归档后项目将变为只读，仅管理员可修改归档信息</p>
            </div>
            <div className="px-6 py-4">
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>项目名称</label>
                <div className="text-sm px-3 py-2 rounded border" style={{ backgroundColor: '#F9FAFB', borderColor: '#E5E7EB', color: '#1F2937' }}>{archiveDialog.projectName}</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>归档备注</label>
                <textarea
                  value={archiveNote}
                  onChange={(e) => setArchiveNote(e.target.value)}
                  placeholder="请输入归档原因或备注信息..."
                  className="w-full px-3 py-2 text-sm border rounded resize-none"
                  style={{ borderColor: '#D1D5DB', minHeight: '80px' }}
                />
              </div>
            </div>
            <div className="px-6 py-3 border-t flex justify-end gap-2" style={{ borderColor: '#EEEEEE' }}>
              <button
                onClick={() => { setArchiveDialog(null); setArchiveNote(''); }}
                className="px-4 py-2 text-sm rounded border hover:bg-gray-50"
                style={{ borderColor: '#D1D5DB', color: '#374151' }}
              >
                取消
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="px-4 py-2 text-sm rounded text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#D97706' }}
              >
                {archiving ? '归档中...' : '确认归档'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive Space Dialog */}
      {/* Floating Bug Report Ball */}
      {user && (
        <>
          <div
            className="fixed z-40 cursor-pointer select-none"
            style={{ right: '0px', top: '50%', transform: 'translateY(-50%)' }}
            onMouseEnter={() => setBugHover(true)}
            onMouseLeave={() => setBugHover(false)}
            onClick={() => { setShowBugReport(true); setBugTitle(''); setBugDescription(''); setBugMsg(null); }}
          >
            <div
              className="flex items-center transition-all duration-300 rounded-l-full shadow-lg"
              style={{
                backgroundColor: bugHover ? '#005BB5' : '#0073E6',
                padding: bugHover ? '10px 16px 10px 12px' : '10px 8px 10px 12px',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              {bugHover && (
                <span className="text-xs font-medium text-white whitespace-nowrap ml-1.5" style={{ animation: 'fadeIn 0.2s ease' }}>
                  提交BUG/需求
                </span>
              )}
            </div>
          </div>

          {/* Bug Report Dialog */}
          {showBugReport && createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <div className="bg-white rounded-xl shadow-2xl w-[460px] max-h-[80vh] overflow-hidden" style={{ animation: 'fadeIn 0.2s ease' }}>
                <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#EEEEEE' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#FEF2F2' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-base font-bold" style={{ color: '#1F2937' }}>提交BUG/需求</h3>
                      <p className="text-xs" style={{ color: '#9CA3AF' }}>反馈问题或提出改进建议</p>
                    </div>
                  </div>
                  <button onClick={() => { setShowBugReport(false); setBugMsg(null); }} className="p-1 rounded hover:bg-gray-100">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                <div className="px-6 py-4 space-y-4">
                  {bugMsg && (
                    <div className="px-3 py-2 rounded-md text-sm" style={{
                      backgroundColor: bugMsg.type === 'success' ? '#F0FFF4' : '#FFF5F5',
                      color: bugMsg.type === 'success' ? '#16A34A' : '#DC2626',
                      border: `1px solid ${bugMsg.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
                    }}>
                      {bugMsg.text}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
                      标题 <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={bugTitle}
                      onChange={(e) => setBugTitle(e.target.value)}
                      placeholder="简述问题或需求，如：登录页面按钮错位"
                      className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400"
                      style={{ borderColor: '#D1D5DB' }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>详细描述</label>
                    <textarea
                      value={bugDescription}
                      onChange={(e) => setBugDescription(e.target.value)}
                      placeholder="请描述问题复现步骤、截图位置或需求详细说明..."
                      className="w-full px-3 py-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                      style={{ borderColor: '#D1D5DB', minHeight: '120px' }}
                    />
                  </div>
                </div>
                <div className="px-6 py-3 border-t flex justify-between items-center" style={{ borderColor: '#EEEEEE' }}>
                  <span className="text-xs" style={{ color: '#9CA3AF' }}>提交者: {user.username}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowBugReport(false); setBugMsg(null); }}
                      className="px-4 py-2 text-sm rounded border hover:bg-gray-50"
                      style={{ borderColor: '#D1D5DB', color: '#374151' }}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleBugSubmit}
                      disabled={bugSubmitting}
                      className="px-4 py-2 text-sm rounded text-white hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: '#EF4444' }}
                    >
                      {bugSubmitting ? '提交中...' : '提交'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

          {/* Bug Management Panel */}
          <BugManagementPanel
            show={showBugPanel}
            onToggle={() => setShowBugPanel(!showBugPanel)}
            canManage={user.username === '王光涛'}
          />
        </>
      )}
    </div>
  );
}

// ============ Sidebar Tree ============
function SidebarTree({
  username,
  user,
  tree,
  expandedNodes,
  setExpandedNodes,
  selectedNodeId,
  onSelectCase,
  onTreeChange,
  onToggleSidebar,
  onPreview,
  isManager,
  allUsers,
  testerFilter,
  onTesterFilterChange,
  projectFilter,
  onProjectFilterChange,
  onArchive,
  onOpenKanban,
  onDeleteArchived,
}: {
  username: string;
  user: UserInfo;
  tree: TreeNode[];
  expandedNodes: Set<string>;
  setExpandedNodes: (nodes: Set<string>) => void;
  selectedNodeId: string | null;
  onSelectCase: (node: TreeNode) => void;
  onTreeChange: () => void;
  onToggleSidebar: () => void;
  onPreview: (level: 'project' | 'module', id: number, name: string) => void;
  isManager: boolean;
  allUsers: UserItem[];
  testerFilter: string;
  onTesterFilterChange: (value: string) => void;
  projectFilter: string;
  onProjectFilterChange: (value: string) => void;
  onArchive: (projectId: number, projectName: string) => void;
  onOpenKanban: () => void;
  onDeleteArchived: (projectId: number) => Promise<void> | void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [editingNode, setEditingNode] = useState<{ node: TreeNode; newName: string } | null>(null);
  const [addingNode, setAddingNode] = useState<{ parentId: string; type: 'project' | 'module' | 'case'; name: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TreeNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState<string | null>(null);
  const [importingProject, setImportingProject] = useState<{ id: string; dbId: number; name: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors?: string[]; projectName?: string } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [ioMenuNode, setIoMenuNode] = useState<{ id: string; dbId: number; name: string } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [assigningNode, setAssigningNode] = useState<{ node: TreeNode; userId: string } | null>(null);

  // Close IO menu on outside click
  useEffect(() => {
    if (!ioMenuNode) return;
    const handler = () => setIoMenuNode(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [ioMenuNode]);

  const handleAssign = async () => {
    if (!assigningNode || !assigningNode.userId) return;
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: assigningNode.node.type,
          targetId: assigningNode.node.dbId,
          userId: Number(assigningNode.userId),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAssigningNode(null);
        setContextMenu(null);
        onTreeChange();
      }
    } catch (error) {
      console.error('Assign error:', error);
    }
  };

  const handleRemoveAssignment = async (level: string, targetId: number) => {
    try {
      await fetch(`/api/assignments?level=${level}&targetId=${targetId}`, { method: 'DELETE' });
      setContextMenu(null);
      onTreeChange();
    } catch (error) {
      console.error('Remove assignment error:', error);
    }
  };

  const toggleExpand = (nodeId: string) => {
    const newSet = new Set(expandedNodes);
    if (newSet.has(nodeId)) newSet.delete(nodeId);
    else newSet.add(nodeId);
    setExpandedNodes(newSet);
  };

  const handleContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleAddNode = (parentId: string, type: 'project' | 'module' | 'case') => {
    setAddingNode({ parentId, type, name: '' });
    setContextMenu(null);
    // Auto-expand the parent node so the input field appears
    if (parentId !== 'root' && !expandedNodes.has(parentId)) {
      const newSet = new Set(expandedNodes);
      newSet.add(parentId);
      setExpandedNodes(newSet);
    }
  };

  const confirmAddNode = async () => {
    if (!addingNode || !addingNode.name.trim()) return;
    try {
      if (addingNode.type === 'project') {
        await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: addingNode.name.trim() }),
        });
      } else if (addingNode.type === 'module') {
        const projectId = Number(addingNode.parentId.replace('project-', ''));
        await fetch('/api/modules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, name: addingNode.name.trim() }),
        });
      } else if (addingNode.type === 'case') {
        const moduleId = Number(addingNode.parentId.replace('module-', ''));
        await fetch('/api/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleId, caseNo: addingNode.name.trim() }),
        });
      }
      setAddingNode(null);
      onTreeChange();
    } catch (error) {
      console.error('Add node error:', error);
    }
  };

  const handleRename = async () => {
    if (!editingNode || !editingNode.newName.trim()) return;
    try {
      const { node, newName } = editingNode;
      if (node.type === 'project') {
        await fetch('/api/projects', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: node.dbId, name: newName.trim() }),
        });
      } else if (node.type === 'module') {
        await fetch('/api/modules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: node.dbId, name: newName.trim() }),
        });
      } else if (node.type === 'case') {
        // Parse the new name: first token is case_no, rest is case_name
        const trimmedName = newName.trim();
        const spaceIdx = trimmedName.indexOf(' ');
        let newCaseNo = '';
        let newCaseName = trimmedName;
        if (spaceIdx > 0) {
          newCaseNo = trimmedName.substring(0, spaceIdx);
          newCaseName = trimmedName.substring(spaceIdx + 1).trim();
        }
        await fetch('/api/cases', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: node.dbId, case_name: newCaseName, case_no: newCaseNo, saveType: 'rename' }),
        });
      }
      setEditingNode(null);
      onTreeChange();
      // Refresh case detail if the renamed case is currently selected
      if (node.type === 'case' && selectedNodeId === node.id) {
        onSelectCase(node);
      }
    } catch (error) {
      console.error('Rename error:', error);
    }
  };

  const handleDelete = async (node: TreeNode) => {
    setDeleteConfirm(node);
  };

  const confirmDelete = async () => {
    const node = deleteConfirm;
    if (!node) return;
    setDeleting(true);
    try {
      let res: Response | null = null;
      if (node.type === 'project') {
        res = await fetch(`/api/projects?id=${node.dbId}`, { method: 'DELETE' });
      } else if (node.type === 'module') {
        res = await fetch(`/api/modules?id=${node.dbId}`, { method: 'DELETE' });
      } else if (node.type === 'case') {
        res = await fetch(`/api/cases?id=${node.dbId}`, { method: 'DELETE' });
      }
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.success) {
          setDeleteConfirm(null);
          onTreeChange();
        } else {
          setDeleteErrorMsg(data.error || '删除失败');
        }
      } else {
        const data = await res?.json().catch(() => ({}));
        setDeleteErrorMsg(data?.error || '删除失败');
      }
    } catch {
      setDeleteErrorMsg('网络错误，请重试');
    } finally {
      setDeleting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !importingProject) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', importingProject.dbId.toString());
      const res = await fetch('/api/cases/import', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setImportResult({ imported: data.imported, skipped: data.skipped, errors: data.errors, projectName: data.projectName });
        onTreeChange();
      } else {
        setImportResult({ imported: 0, skipped: 0, errors: [data.error || '导入失败'] });
      }
    } catch {
      setImportResult({ imported: 0, skipped: 0, errors: ['网络错误，请重试'] });
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleExport = async (projectId: number, projectName: string) => {
    try {
      const res = await fetch(`/api/cases/export?projectId=${projectId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '导出失败' }));
        setMessage({ type: 'error', text: data.error || '导出失败' });
        setTimeout(() => setMessage(null), 1000);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${projectName}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: '导出成功' });
      setTimeout(() => setMessage(null), 1000);
    } catch {
      setMessage({ type: 'error', text: '导出失败，请稍后重试' });
      setTimeout(() => setMessage(null), 1000);
    }
  };

  const getStatusIcon = (testResult: string | null | undefined) => {
    if (!testResult) return null;
    if (testResult === 'Pass') return <span style={{ color: '#22C55E', fontSize: '14px', fontWeight: 'bold' }}>&#10003;</span>;
    if (testResult === 'Fail') return <span style={{ color: '#EF4444', fontSize: '14px', fontWeight: 'bold' }}>&#10007;</span>;
    if (testResult === 'Block') return <span style={{ color: '#EF4444', fontSize: '12px' }}>&#9679;</span>;
    return null;
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = selectedNodeId === node.id;
    const hasChildren = node.children && node.children.length > 0;
    const isEditing = editingNode?.node.id === node.id;
    const paddingLeft = 12 + depth * 16;

    return (
      <div key={node.id}>
        <div
          className="flex items-start py-1 px-2 cursor-pointer group text-sm select-none"
          style={{
            paddingLeft: `${paddingLeft}px`,
            backgroundColor: isSelected ? '#E6F2FF' : 'transparent',
            fontWeight: isSelected ? 'bold' : 'normal',
            color: '#333',
            fontSize: '14px',
          }}
          onClick={() => {
            if (hasChildren || node.type !== 'case') toggleExpand(node.id);
            if (node.type === 'case') onSelectCase(node);
          }}
          onContextMenu={(e) => handleContextMenu(e, node)}
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = '#F0F0F0'; }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {/* Expand/Collapse icon */}
          <span className="w-4 h-4 flex items-center justify-center mr-1 mt-0.5 self-start flex-shrink-0" onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}>
            {hasChildren ? (
              isExpanded ? (
                <span style={{ fontSize: '10px', color: '#666' }}>&#9660;</span>
              ) : (
                <span style={{ fontSize: '10px', color: '#666' }}>&#9654;</span>
              )
            ) : (
              <span style={{ fontSize: '6px', color: '#CCC' }}>&#9679;</span>
            )}
          </span>

          {/* Status icon for cases */}
          {node.type === 'case' && (
            <span className="w-4 h-4 flex items-center justify-center mr-1 mt-0.5 self-start flex-shrink-0">
              {getStatusIcon(node.testResult)}
            </span>
          )}

          {/* Node name */}
          {isEditing ? (
            <input
              autoFocus
              className="flex-1 text-sm px-1 border rounded"
              style={{ borderColor: '#0073E6', outline: 'none', minWidth: '0' }}
              value={editingNode.newName}
              onChange={(e) => setEditingNode({ ...editingNode, newName: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setEditingNode(null);
              }}
              onBlur={handleRename}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 min-w-0">
                <span className="truncate">{node.name}</span>
                {node.isArchived && (
                  <span className="text-xs px-1 rounded flex-shrink-0" style={{ color: '#92400E', backgroundColor: '#FEF3C7', fontSize: '10px' }}>已归档</span>
                )}
                {node.type === 'module' && node.resolvedTesterNames && (
                  <span className="text-xs px-1 rounded truncate" style={{ color: '#999', backgroundColor: '#F5F5F5', fontSize: '10px', maxWidth: '120px' }} title={node.resolvedTesterNames}>{node.resolvedTesterNames}</span>
                )}
                {node.type === 'case' && node.testerName && (
                  <span className="text-xs px-1 rounded flex-shrink-0" style={{ color: '#8B5CF6', backgroundColor: '#F5F3FF', fontSize: '10px' }}>{node.testerName}</span>
                )}
              </span>
              {node.type === 'project' && node.resolvedTesterNames && (
                <span className="mt-0.5 block text-[10px] leading-4 whitespace-normal break-words" style={{ color: '#64748B' }}>
                  {node.resolvedTesterNames}
                </span>
              )}
            </span>
          )}

          {/* Action buttons on hover - managers only */}
          {!isEditing && isManager && (
            <span className="hidden group-hover:flex items-center gap-0.5 ml-1 flex-shrink-0">
              {/* Assign tester icon - all levels */}
              <button
                className="p-0.5 rounded hover:bg-purple-50"
                title={node.testerName ? `重新分配 (${node.testerName})` : '分配测试者'}
                onClick={(e) => {
                  e.stopPropagation();
                  setAssigningNode({ node, userId: '' });
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              </button>
              {(node.type === 'project' || node.type === 'module') && (
                <button
                  className="p-0.5 rounded hover:bg-green-50"
                  title="预览测试进度"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreview(node.type as 'project' | 'module', node.dbId, node.name);
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                </button>
              )}
              {node.type === 'project' && (
                <button
                  className="p-0.5 rounded hover:bg-blue-50"
                  title="导入/导出用例"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIoMenuNode(ioMenuNode?.id === node.id ? null : { id: node.id, dbId: node.dbId, name: node.name });
                    const rect = e.currentTarget.getBoundingClientRect();
                    window.__ioMenuPos = { x: rect.left, y: rect.bottom + 4 };
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0073E6" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                </button>
              )}
              {node.type !== 'case' && (
                <button
                  className="p-0.5 rounded hover:bg-gray-200"
                  title="添加子节点"
                  onClick={(e) => {
                    e.stopPropagation();
                    const childType = node.type === 'project' ? 'module' : 'case';
                    handleAddNode(node.id, childType);
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
              )}
              <button
                className="p-0.5 rounded hover:bg-gray-200"
                title="重命名"
                onClick={(e) => {
                  e.stopPropagation();
                  // For case nodes, edit the full display name (case_no + case_name)
                  setEditingNode({ node, newName: node.name });
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
              </button>
              <button
                className="p-0.5 rounded hover:bg-red-100"
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(node);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </span>
          )}
        </div>

        {/* Children */}
        {hasChildren && isExpanded && node.children!.map(child => renderNode(child, depth + 1))}

        {/* Add node input */}
        {addingNode && addingNode.parentId === node.id && (
          <div className="flex items-center py-1 px-2" style={{ paddingLeft: `${paddingLeft + 16 + 20}px` }}>
            <input
              autoFocus
              className="flex-1 text-sm px-1 border rounded"
              style={{ borderColor: '#0073E6', outline: 'none', minWidth: '0' }}
              placeholder={addingNode.type === 'project' ? '输入项目名称' : addingNode.type === 'module' ? '输入模块名称' : '输入用例编号'}
              value={addingNode.name}
              onChange={(e) => setAddingNode({ ...addingNode, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmAddNode();
                if (e.key === 'Escape') setAddingNode(null);
              }}
              onBlur={() => { if (addingNode.name.trim()) confirmAddNode(); else setAddingNode(null); }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#EEEEEE' }}>
        <span className="font-bold text-sm" style={{ color: '#333' }}>任务列表</span>
        <div className="flex items-center gap-1">
          {isManager && (
            <button
              onClick={() => setAddingNode({ parentId: 'root', type: 'project', name: '' })}
              className="p-1 rounded hover:bg-gray-200 transition-colors"
              title="新建项目"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0073E6" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          )}
          <button
            onClick={onToggleSidebar}
            className="p-1 rounded hover:bg-gray-200 transition-colors"
            title="折叠侧边栏"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </div>
      </div>

      {/* Two-level Filter */}
      <div className="px-3 py-2 border-b space-y-2" style={{ borderColor: '#EEEEEE' }}>
        {/* Level 1: Project Status */}
        <select
          value={projectFilter}
          onChange={(e) => onProjectFilterChange(e.target.value)}
          className="w-full text-xs px-2 py-1.5 border rounded"
          style={{ borderColor: '#D1D5DB', color: '#374151', backgroundColor: '#FFF' }}
        >
          <option value="active">进行中的项目</option>
          <option value="archived">已归档项目</option>
          <option value="all">全部项目</option>
        </select>
        {/* Level 2: Tester */}
        <select
          value={testerFilter}
          onChange={(e) => onTesterFilterChange(e.target.value)}
          className="w-full text-xs px-2 py-1.5 border rounded"
          style={{ borderColor: '#D1D5DB', color: '#374151', backgroundColor: '#FFF' }}
        >
          <option value="">全部执行者</option>
          {!isManager && <option value="my">我的任务</option>}
          {allUsers.map(u => (
            <option key={u.id} value={String(u.id)}>{u.username}</option>
          ))}
        </select>
        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          {projectFilter === 'active' && (
            <button
              onClick={onOpenKanban}
              className="w-full text-xs px-2 py-1.5 rounded border hover:bg-blue-50 transition-colors flex items-center justify-center gap-1"
              style={{ borderColor: '#0073E6', color: '#0073E6' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
              项目看板
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="sidebar-tree-scroll flex-1 overflow-y-auto overflow-x-hidden py-1" style={{ scrollbarGutter: 'stable' }}>
        {/* Add project input */}
        {addingNode && addingNode.parentId === 'root' && (
          <div className="flex items-center py-1 px-2" style={{ paddingLeft: '12px' }}>
            <input
              autoFocus
              className="flex-1 text-sm px-1 border rounded"
              style={{ borderColor: '#0073E6', outline: 'none', minWidth: '0' }}
              placeholder="输入项目名称"
              value={addingNode.name}
              onChange={(e) => setAddingNode({ ...addingNode, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmAddNode();
                if (e.key === 'Escape') setAddingNode(null);
              }}
              onBlur={() => { if (addingNode.name.trim()) confirmAddNode(); else setAddingNode(null); }}
            />
          </div>
        )}
        {tree.map(node => renderNode(node, 0))}
        {tree.length === 0 && !(addingNode && addingNode.parentId === 'root') && (
          <div className="text-center py-3 text-xs" style={{ color: '#999', paddingLeft: '12px' }}>
            暂无项目，点击 + 创建
          </div>
        )}
      </div>

      {/* Delete Confirm Dialog - rendered via Portal to avoid overflow:hidden clipping */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
          <div className="bg-white rounded-lg shadow-xl p-5" style={{ minWidth: '320px' }}>
            <div className="flex items-center gap-2 mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span className="font-bold text-sm" style={{ color: '#333' }}>确认删除</span>
            </div>
            <p className="text-sm mb-4" style={{ color: '#666' }}>
              确定要删除{deleteConfirm.type === 'project' ? '项目' : deleteConfirm.type === 'module' ? '模块' : '用例'}「{deleteConfirm.name}」及其所有子内容吗？此操作不可撤销。
            </p>
            {deleteErrorMsg && (
              <div className="mb-3 px-3 py-2 rounded text-xs" style={{ backgroundColor: '#FEF2F2', color: '#EF4444', border: '1px solid #FECACA' }}>
                {deleteErrorMsg}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setDeleteConfirm(null); setDeleteErrorMsg(null); }}
                disabled={deleting}
                className="px-4 py-1.5 text-sm rounded border hover:bg-gray-50 transition-colors disabled:opacity-50"
                style={{ borderColor: '#EEEEEE', color: '#666' }}
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-1.5 text-sm rounded text-white transition-colors disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: '#EF4444' }}
                onMouseEnter={(e) => { if (!deleting) e.currentTarget.style.backgroundColor = '#DC2626'; }}
                onMouseLeave={(e) => { if (!deleting) e.currentTarget.style.backgroundColor = '#EF4444'; }}
              >
                {deleting && (
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                )}
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Context Menu - rendered via Portal to avoid overflow:hidden clipping */}
      {contextMenu && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          <div
            className="fixed z-50 bg-white rounded-md shadow-lg border py-1"
            style={{ left: contextMenu.x, top: contextMenu.y, borderColor: '#EEEEEE', minWidth: '160px' }}
          >
            {isManager && contextMenu.node.type === 'project' && (
              <>
                {!contextMenu.node.isArchived && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-amber-50"
                    style={{ color: '#D97706' }}
                    onClick={() => { onArchive(contextMenu.node.dbId, contextMenu.node.name); setContextMenu(null); }}
                  >
                    归档项目
                  </button>
                )}
                {contextMenu.node.isArchived && user?.role === 'admin' && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-red-50"
                    style={{ color: '#EF4444' }}
                    onClick={() => { onDeleteArchived(contextMenu.node.dbId); setContextMenu(null); }}
                  >
                    删除归档
                  </button>
                )}
                {!contextMenu.node.isArchived && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
                    style={{ color: '#333' }}
                    onClick={() => handleAddNode(contextMenu.node.id, 'module')}
                  >
                    新建模块
                  </button>
                )}
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
                  style={{ color: '#0073E6' }}
                  onClick={() => { setImportingProject({ id: contextMenu.node.id, dbId: contextMenu.node.dbId, name: contextMenu.node.name }); setContextMenu(null); }}
                >
                  导入测试用例
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
                  style={{ color: '#10B981' }}
                  onClick={() => { handleExport(contextMenu.node.dbId, contextMenu.node.name); setContextMenu(null); }}
                >
                  导出测试用例
                </button>
              </>
            )}
            {isManager && contextMenu.node.type === 'module' && !contextMenu.node.isArchived && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
                style={{ color: '#333' }}
                onClick={() => handleAddNode(contextMenu.node.id, 'case')}
              >
                新建用例
              </button>
            )}
            {/* Assign tester option - managers only */}
            {isManager && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
                style={{ color: '#8B5CF6' }}
                onClick={() => { setAssigningNode({ node: contextMenu.node, userId: '' }); setContextMenu(null); }}
              >
                {contextMenu.node.testerName ? `重新分配 (${contextMenu.node.testerName})` : '分配测试者'}
              </button>
            )}
            {isManager && contextMenu.node.testerName && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-red-50"
                style={{ color: '#EF4444' }}
                onClick={() => { handleRemoveAssignment(contextMenu.node.type, contextMenu.node.dbId); }}
              >
                取消分配
              </button>
            )}
            {isManager && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100"
                style={{ color: '#333' }}
                onClick={() => { 
                  setEditingNode({ node: contextMenu.node, newName: contextMenu.node.name }); 
                  setContextMenu(null); 
                }}
              >
                重命名
              </button>
            )}
            {isManager && (
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-red-50"
                style={{ color: '#EF4444' }}
                onClick={() => { handleDelete(contextMenu.node); setContextMenu(null); }}
              >
                删除
              </button>
            )}
            {!isManager && (
              <div className="px-3 py-2 text-xs" style={{ color: '#999' }}>
                仅管理者可操作
              </div>
            )}
          </div>
        </>,
        document.body
      )}

      {/* Import Dialog - rendered via Portal to avoid overflow:hidden clipping */}
      {importingProject && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
          <div className="bg-white rounded-lg shadow-xl p-5" style={{ minWidth: '400px', maxWidth: '500px' }}>
            <div className="flex items-center gap-2 mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0073E6" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              <span className="font-bold text-sm" style={{ color: '#333' }}>导入测试用例 - {importingProject.name}</span>
            </div>
            <div className="mb-3 text-xs" style={{ color: '#666' }}>
              <p className="mb-1">导入规则：</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Sheet 名称 = 特性名称（自动创建）</li>
                <li>每行数据 = 一条测试用例</li>
                <li>自动忽略 Summary 工作表</li>
                <li>测试结果为 NA 的用例不导入</li>
                <li>合并单元格内容自动填充到所有行</li>
                <li>支持空值，不做必填校验</li>
              </ul>
            </div>
            <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
            {!importResult ? (
              <>
                <button
                  onClick={() => importFileRef.current?.click()}
                  disabled={importing}
                  className="w-full py-2 border-2 border-dashed rounded-md text-sm transition-colors disabled:opacity-50"
                  style={{ borderColor: '#0073E6', color: '#0073E6', backgroundColor: '#F0F7FF' }}
                >
                  {importing ? '导入中...' : '选择 Excel 文件'}
                </button>
                {importing && (
                  <div className="mt-2">
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full rounded-full animate-pulse" style={{ width: '60%', backgroundColor: '#0073E6' }} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="border rounded-md p-3" style={{ borderColor: '#EEEEEE', backgroundColor: '#FAFAFA' }}>
                <div className="flex items-center gap-2 mb-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                  <span className="font-bold text-sm" style={{ color: '#333' }}>导入完成</span>
                </div>
                <p className="text-sm" style={{ color: '#333' }}>成功导入 <b>{importResult.imported}</b> 条用例</p>
                {importResult.skipped > 0 && (
                  <p className="text-sm" style={{ color: '#F97316' }}>跳过 <b>{importResult.skipped}</b> 条（重复或数据异常）</p>
                )}
                {importResult.errors && importResult.errors.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto">
                    {importResult.errors.map((err, idx) => (
                      <p key={idx} className="text-xs" style={{ color: '#EF4444' }}>{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button
                onClick={() => { setImportingProject(null); setImportResult(null); setImporting(false); }}
                className="px-4 py-1.5 text-sm rounded border hover:bg-gray-50 transition-colors"
                style={{ borderColor: '#EEEEEE', color: '#666' }}
              >
                {importResult ? '关闭' : '取消'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Assign Tester Dialog - rendered via Portal */}
      {assigningNode && isManager && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
          <div className="bg-white rounded-lg shadow-xl p-5" style={{ minWidth: '360px', maxWidth: '440px' }}>
            <div className="flex items-center gap-2 mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              <span className="font-bold text-sm" style={{ color: '#333' }}>
                分配测试者 - {assigningNode.node.name}
              </span>
            </div>
            <p className="text-xs mb-3" style={{ color: '#666' }}>
              将{assigningNode.node.type === 'project' ? '项目' : assigningNode.node.type === 'module' ? '模块' : '用例'}分配给测试者，其下所有用例将自动获得编辑权限
            </p>
            {assigningNode.node.testerName && (
              <div className="mb-3 px-3 py-2 rounded text-xs" style={{ backgroundColor: '#F5F3FF', color: '#8B5CF6', border: '1px solid #DDD6FE' }}>
                当前测试者: {assigningNode.node.testerName}
              </div>
            )}
            <select
              value={assigningNode.userId}
              onChange={(e) => setAssigningNode({ ...assigningNode, userId: e.target.value })}
              className="w-full px-3 py-2 border rounded-md text-sm mb-4"
              style={{ borderColor: '#D1D5DB', color: '#374151' }}
            >
              <option value="">选择测试者...</option>
              {allUsers.filter(u => !MANAGER_USERNAMES.includes(u.username)).map(u => (
                <option key={u.id} value={String(u.id)}>{u.username}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAssigningNode(null)}
                className="px-4 py-1.5 text-sm rounded border hover:bg-gray-50 transition-colors"
                style={{ borderColor: '#EEEEEE', color: '#666' }}
              >
                取消
              </button>
              <button
                onClick={handleAssign}
                disabled={!assigningNode.userId}
                className="px-4 py-1.5 text-sm rounded text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#8B5CF6' }}
              >
                确认分配
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Import/Export Portal Menu */}
      {ioMenuNode && createPortal(
        <div className="fixed inset-0 z-[9998]" onClick={() => setIoMenuNode(null)}>
          <div
            className="fixed bg-white border rounded-md shadow-xl py-1"
            style={{
              minWidth: '160px',
              left: window.__ioMenuPos?.x ?? 0,
              top: window.__ioMenuPos?.y ?? 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2"
              style={{ color: '#333' }}
              onClick={() => {
                setImportingProject({ id: ioMenuNode.id, dbId: ioMenuNode.dbId, name: ioMenuNode.name });
                setIoMenuNode(null);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0073E6" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              导入测试用例
            </button>
            <button
              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2"
              style={{ color: '#333' }}
              onClick={() => {
                handleExport(ioMenuNode.dbId, ioMenuNode.name);
                setIoMenuNode(null);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              导出测试用例
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Global Centered Toast for Sidebar */}
      {message && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none" style={{ animation: 'toastFadeIn 0.2s ease-out' }}>
          <div
            className="px-6 py-3 rounded-lg text-sm font-medium shadow-lg pointer-events-auto flex items-center gap-2"
            style={{
              backgroundColor: message.type === 'success' ? '#F0FFF4' : '#FFF5F5',
              color: message.type === 'success' ? '#16A34A' : '#DC2626',
              border: `1px solid ${message.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
              animation: 'toastSlideIn 0.25s ease-out',
            }}
          >
            {message.type === 'success' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            )}
            {message.text}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ============ Case Detail ============
function CaseDetail({
  caseData,
  files,
  onUpdate,
  onFilesChange,
  onPreviewFile,
  permissions,
  tester,
  isManager,
  allUsers,
  onAssignTester,
  onRemoveTesterAssignment,
}: {
  caseData: CaseData;
  files: FileData[];
  onUpdate: (updated: CaseData) => void;
  onFilesChange: (files: FileData[]) => void;
  onPreviewFile: (fileId: number, content: string, filename: string, truncated: boolean) => void;
  permissions: CasePermissions;
  tester: CaseTester | null;
  isManager: boolean;
  allUsers: UserItem[];
  onAssignTester: (caseId: number, userId: number) => void;
  onRemoveTesterAssignment: (caseId: number) => void;
}) {
  const nullToEmpty = (v: string | null | undefined) => v ?? '';
  const [form, setForm] = useState({
    ...caseData,
    test_device: nullToEmpty(caseData.test_device),
    light: nullToEmpty(caseData.light),
    temperature: nullToEmpty(caseData.temperature),
    case_name: nullToEmpty(caseData.case_name),
    case_no: nullToEmpty(caseData.case_no),
    test_category: nullToEmpty(caseData.test_category),
    feature: nullToEmpty(caseData.feature),
    trait: nullToEmpty(caseData.trait),
    test_env: nullToEmpty(caseData.test_env),
    pre_operation: nullToEmpty(caseData.pre_operation),
    step: nullToEmpty(caseData.step),
    expect_result: nullToEmpty(caseData.expect_result),
    note: nullToEmpty(caseData.note),
    jira_link: nullToEmpty(caseData.jira_link),
    fail_note: nullToEmpty(caseData.fail_note),
    test_log: nullToEmpty(caseData.test_log),
    executor: nullToEmpty(caseData.executor),
    test_result_note: nullToEmpty(caseData.test_result_note),
    test_result: caseData.test_result ?? '',
    priority: nullToEmpty(caseData.priority),
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ active: boolean; percent: number; label: string }>({ active: false, percent: 0, label: '' });
  const [renamingFile, setRenamingFile] = useState<{ id: number; name: string } | null>(null);
  const [caseDragOver, setCaseDragOver] = useState(false);
  const caseDragCounterRef = useRef(0);
  const [editingJira, setEditingJira] = useState(false);
  const [jiraLinkError, setJiraLinkError] = useState(false);
  const [editingMode, setEditingMode] = useState(false); // Manager edit mode toggle
  const [showTesterAssign, setShowTesterAssign] = useState(false); // Tester assign dropdown
  const testerAssignRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Normalize null values to empty strings to avoid React "value prop should not be null" warning
    setForm({
      ...caseData,
      test_result: caseData.test_result ?? '',
      test_device: caseData.test_device ?? '',
      light: caseData.light ?? '',
      temperature: caseData.temperature ?? '',
      case_name: caseData.case_name ?? '',
      case_no: caseData.case_no ?? '',
      test_category: caseData.test_category ?? '',
      feature: caseData.feature ?? '',
      trait: caseData.trait ?? '',
      test_env: caseData.test_env ?? '',
      pre_operation: caseData.pre_operation ?? '',
      step: caseData.step ?? '',
      expect_result: caseData.expect_result ?? '',
      note: caseData.note ?? '',
      jira_link: caseData.jira_link ?? '',
      fail_note: caseData.fail_note ?? '',
      test_log: caseData.test_log ?? '',
      executor: caseData.executor ?? '',
      test_result_note: caseData.test_result_note ?? '',
      priority: caseData.priority ?? '',
    });
    setEditingMode(false); // Reset edit mode when case changes
  }, [caseData]);

  // Close tester assign dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (testerAssignRef.current && !testerAssignRef.current.contains(e.target as Node)) {
        setShowTesterAssign(false);
      }
    };
    if (showTesterAssign) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTesterAssign]);

  // Helper: recursively read all files from a drag-and-drop directory entry
  // Returns files array and a map of file index -> relative path
  const readAllDirectoryEntries = async (dirEntry: FileSystemDirectoryEntry, basePath: string): Promise<{ files: File[]; paths: Record<number, string> }> => {
    const results: File[] = [];
    const paths: Record<number, string> = {};
    const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      const reader = dirEntry.createReader();
      const allEntries: FileSystemEntry[] = [];
      const readBatch = () => {
        reader.readEntries((batch) => {
          if (batch.length === 0) {
            resolve(allEntries);
          } else {
            allEntries.push(...batch);
            readBatch();
          }
        }, reject);
      };
      readBatch();
    });

    for (const entry of entries) {
      const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve, reject) => {
          fileEntry.file(resolve, reject);
        });
        paths[results.length] = entryPath;
        results.push(file);
      } else if (entry.isDirectory) {
        const subResult = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry, entryPath);
        for (const [idx, p] of Object.entries(subResult.paths)) {
          paths[results.length + Number(idx)] = p;
        }
        results.push(...subResult.files);
      }
    }
    return { files: results, paths };
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCaseDragOver(false);
    caseDragCounterRef.current = 0;
    if (uploading) return;

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) {
      if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
      return;
    }

    // Check if any dropped item is a directory using webkitGetAsEntry
    const allFiles: File[] = [];
    const allPaths: Record<number, string> = {};
    let hasDirectory = false;
    let folderName = '';

    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        hasDirectory = true;
        folderName = folderName || entry.name;
        const { files: dirFiles, paths: dirPaths } = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry, entry.name);
        // Remap paths indices to account for files already in allFiles
        for (const [idx, p] of Object.entries(dirPaths)) {
          allPaths[allFiles.length + Number(idx)] = p;
        }
        allFiles.push(...dirFiles);
      } else if (entry?.isFile) {
        const file = e.dataTransfer.files[i];
        if (file) allFiles.push(file);
      }
    }

    if (allFiles.length > 0) {
      handleFileUpload(allFiles, hasDirectory ? folderName : undefined, hasDirectory ? allPaths : undefined);
    } else if (!hasDirectory) {
      // Fallback: no entries support, use files directly
      if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleFieldChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setMessage(null);
    if (field === 'jira_link') setJiraLinkError(false);
  };

  const handleSave = async (saveType: 'core' | 'result' = 'result') => {
    // Validate jira_link format if provided
    if (form.jira_link && form.jira_link.trim() && !/^https?:\/\/.+/.test(form.jira_link.trim())) {
      setMessage({ type: 'error', text: 'Jira链接格式不正确，需以http://或https://开头' });
      setJiraLinkError(true);
      setTimeout(() => setMessage(null), 1000);
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        id: form.id,
        saveType,
      };

      if (saveType === 'core') {
        // Core fields - manager only
        Object.assign(body, {
          case_name: form.case_name,
          priority: form.priority,
          test_env: form.test_env,
          pre_operation: form.pre_operation,
          step: form.step,
          expect_result: form.expect_result,
          note: form.note,
          case_no: form.case_no,
          test_category: form.test_category,
          feature: form.feature,
          trait: form.trait,
          light: form.light,
          temperature: form.temperature,
        });
      } else {
        // Result fields - manager or tester
        Object.assign(body, {
          test_device: form.test_device,
          test_result: form.test_result,
          jira_link: form.jira_link,
          fail_note: form.fail_note,
          test_log: form.test_log,
          test_result_note: form.test_result_note,
        });
      }

      const res = await fetch('/api/cases', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: saveType === 'core' ? '基础信息保存成功' : '测试结果保存成功' });
        setEditingMode(false);
        onUpdate(form);
      } else {
        setMessage({ type: 'error', text: data.error || '保存失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '保存失败，请稍后重试' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 1000);
    }
  };

  const handleFileUpload = async (fileList: FileList | File[], folderName?: string, filePaths?: Record<number, string>) => {
    setUploading(true);
    setUploadProgress({ active: true, percent: 0, label: `上传中 (0/${fileList.length})...` });
    try {
      const formData = new FormData();
      formData.append('caseId', form.id.toString());
      for (let i = 0; i < fileList.length; i++) {
        formData.append('files', fileList[i]);
      }
      // If folder was detected via drag-and-drop, send folder name signal and file paths
      if (folderName) {
        formData.append('folderName', folderName);
      }
      if (filePaths && Object.keys(filePaths).length > 0) {
        formData.append('filePaths', JSON.stringify(filePaths));
      }

      // Use XHR for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(prev => ({ ...prev, percent: pct, label: `上传中 (${pct}%)...` }));
          }
        });
        xhr.addEventListener('load', () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.success) {
              // Refresh files list
              fetch(`/api/cases/${form.id}?_t=${Date.now()}`)
                .then(r => r.json())
                .then(filesData => {
                  if (filesData.files) {
                    onFilesChange(filesData.files);
                  }
                });
              setMessage({ type: 'success', text: '文件上传成功' });
              resolve();
            } else {
              setMessage({ type: 'error', text: data.error || '上传失败' });
              reject(new Error(data.error));
            }
          } catch {
            reject(new Error('Parse error'));
          }
        });
        xhr.addEventListener('error', () => {
          setMessage({ type: 'error', text: '上传失败，请稍后重试' });
          reject(new Error('Network error'));
        });
        xhr.open('POST', '/api/files/upload');
        xhr.send(formData);
      });
    } catch {
      setMessage({ type: 'error', text: '上传失败，请稍后重试' });
    } finally {
      setUploading(false);
      setUploadProgress({ active: false, percent: 0, label: '' });
      setTimeout(() => setMessage(null), 1000);
    }
  };

  const handleDeleteFile = async (fileId: number) => {
    if (!confirm('确定要删除此文件吗？')) return;
    try {
      const res = await fetch('/api/files/' + fileId, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      });
      const data = await res.json();
      if (data.success) {
        onFilesChange(files.filter(f => f.id !== fileId));
        setMessage({ type: 'success', text: '文件已删除' });
      }
    } catch {
      setMessage({ type: 'error', text: '删除文件失败' });
    }
    setTimeout(() => setMessage(null), 1000);
  };

  const handleRenameFile = async (fileId: number, newName: string) => {
    if (!newName.trim()) { setRenamingFile(null); return; }
    try {
      await fetch('/api/files/' + fileId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, originalName: newName.trim() }),
      });
      onFilesChange(files.map(f => f.id === fileId ? { ...f, original_name: newName.trim() } : f));
    } catch { /* ignore */ }
    setRenamingFile(null);
  };

  const handlePreviewFile = async (fileId: number, fileType?: string) => {
    const ext = fileType?.toLowerCase() || '';
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext);
    if (isImage) {
      // For image files, open preview dialog with the preview URL
      const file = files.find(f => f.id === fileId);
      onPreviewFile(fileId, '', file?.original_name || '', false);
      return;
    }
    try {
      const res = await fetch(`/api/files/preview/${fileId}`);
      const data = await res.json();
      if (data.content !== undefined) {
        onPreviewFile(fileId, data.content, data.filename, data.truncated);
      } else if (data.error) {
        setMessage({ type: 'error', text: data.error });
        setTimeout(() => setMessage(null), 1000);
      }
    } catch {
      setMessage({ type: 'error', text: '预览失败' });
      setTimeout(() => setMessage(null), 1000);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const isImageFile = (ext: string) => ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext.toLowerCase());
  const isTextFile = (ext: string) => ['.txt', '.log', '.csv', '.json', '.xml', '.yaml', '.yml', '.md', '.ini', '.conf', '.cfg', '.properties'].includes(ext.toLowerCase());

  // Filter out editor screenshots from file list display
  const displayFiles = files.filter(f => f.source !== 'editor');

  // Whether the current user can edit core fields
  const canEditCore = permissions.canEditCore && (isManager ? editingMode : permissions.canEditCore);
  // Whether the current user can edit result fields
  const canEditResult = permissions.canEditResult;

  // Unified read-only style: no gray background, no disabled cursor - just clean text display
  const readOnlyInputStyle = (editable: boolean) => ({
    borderColor: 'transparent' as const,
    color: editable ? '#1F2937' : '#1F2937',
    backgroundColor: 'transparent' as const,
    cursor: editable ? ('text' as const) : ('default' as const),
  });

  const readOnlyTextareaStyle = (editable: boolean) => ({
    color: editable ? '#1F2937' : '#1F2937',
    backgroundColor: 'transparent' as const,
    cursor: editable ? ('text' as const) : ('default' as const),
  });

  return (
    <div
      className="p-5 relative"
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); caseDragCounterRef.current++; if (e.dataTransfer.types.includes('Files')) setCaseDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); caseDragCounterRef.current--; if (caseDragCounterRef.current === 0) setCaseDragOver(false); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {caseDragOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,115,230,0.08)', border: '3px dashed #0073E6', borderRadius: '8px' }}>
          <div className="text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0073E6" strokeWidth="1.5" className="mx-auto">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="mt-2 text-sm font-medium" style={{ color: '#0073E6' }}>松开鼠标上传文件</p>
            <p className="text-xs mt-1" style={{ color: '#666' }}>支持拖拽文件和文件夹（文件夹自动压缩为ZIP）</p>
          </div>
        </div>
      )}
      {/* Global Centered Toast */}
      {message && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none" style={{ animation: 'toastFadeIn 0.2s ease-out' }}>
          <div
            className="px-6 py-3 rounded-lg text-sm font-medium shadow-lg pointer-events-auto flex items-center gap-2"
            style={{
              backgroundColor: message.type === 'success' ? '#F0FFF4' : '#FFF5F5',
              color: message.type === 'success' ? '#16A34A' : '#DC2626',
              border: `1px solid ${message.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
              animation: 'toastSlideIn 0.25s ease-out',
            }}
          >
            {message.type === 'success' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            )}
            {message.text}
          </div>
        </div>,
        document.body
      )}

      {/* Breadcrumb & Title with Priority Badge */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <div className="text-xs" style={{ color: '#888' }}>
                {form.project_name} / {form.module_name}
              </div>
              <h1 className="text-lg font-bold mt-0.5" style={{ color: '#1A1A1A', fontSize: '18px' }}>
                {form.case_no?.trim() && form.case_name?.trim() ? `${form.case_no.trim()} ${form.case_name}` : form.case_no?.trim() || form.case_name || '新用例'}
              </h1>
            </div>
            {/* Priority Badge - Jira style icon next to title */}
            <div className="relative" style={{ marginTop: '18px' }}>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border cursor-pointer transition-all"
                style={{
                  borderColor: form.priority === 'High' ? '#FCA5A5' : form.priority === 'Middle' ? '#FCD34D' : '#93C5FD',
                  color: form.priority === 'High' ? '#DC2626' : form.priority === 'Middle' ? '#D97706' : '#2563EB',
                  backgroundColor: form.priority === 'High' ? '#FEF2F2' : form.priority === 'Middle' ? '#FFFBEB' : '#EFF6FF',
                }}
                onClick={() => {
                  if (!canEditCore) return;
                  const next = form.priority === 'High' ? 'Middle' : form.priority === 'Middle' ? 'Low' : 'High';
                  handleFieldChange('priority', next);
                }}
                disabled={!canEditCore}
                title={`Priority: ${form.priority}${canEditCore ? '（点击切换）' : ''}`}
              >
                {/* Priority icon - arrow up / dash / arrow down */}
                {form.priority === 'High' && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="#DC2626"><path d="M8 2l5 5H3l5-5z"/><rect x="6" y="7" width="4" height="6" rx="0.5"/></svg>
                )}
                {form.priority === 'Middle' && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="#D97706"><rect x="2" y="6" width="12" height="4" rx="1"/></svg>
                )}
                {form.priority === 'Low' && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="#2563EB"><path d="M8 14l5-5H3l5 5z"/><rect x="6" y="3" width="4" height="6" rx="0.5"/></svg>
                )}
                {form.priority}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isManager && (
              <button
                onClick={() => {
                  if (editingMode) {
                    if (canEditCore) {
                      handleSave('core');
                    } else {
                      handleSave('result');
                    }
                  } else {
                    setEditingMode(true);
                  }
                }}
                className="text-xs px-3 py-1.5 rounded font-medium transition-all"
                style={{
                  backgroundColor: editingMode ? '#FEF2F2' : '#F0F7FF',
                  color: editingMode ? '#DC2626' : '#0073E6',
                  border: editingMode ? '1px solid #FECACA' : '1px solid #B3D9FF',
                }}
                onMouseOver={(e) => { if (!editingMode) e.currentTarget.style.backgroundColor = '#E0EFFF'; else e.currentTarget.style.backgroundColor = '#FEE2E2'; }}
                onMouseOut={(e) => { if (!editingMode) e.currentTarget.style.backgroundColor = '#F0F7FF'; else e.currentTarget.style.backgroundColor = '#FEF2F2'; }}
              >
                {editingMode ? '保存修改' : '用例修改'}
              </button>
            )}
            {tester && (
              <div className="relative" ref={testerAssignRef}>
                <span
                  className={`text-xs px-2 py-1 rounded ${isManager ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                  style={{ color: '#8B5CF6', backgroundColor: '#F5F3FF', border: '1px solid #DDD6FE' }}
                  onClick={() => { if (isManager) setShowTesterAssign(!showTesterAssign); }}
                  title={isManager ? '点击分配/更换测试者' : undefined}
                >
                  测试者: {tester.name}
                  {tester.assignmentLevel !== 'none' && tester.assignmentLevel !== 'case' && (
                    <span style={{ color: '#A78BFA', marginLeft: '4px' }}>({tester.assignmentLevel === 'project' ? '项目级' : '模块级'})</span>
                  )}
                  {isManager && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" className="inline ml-1"><polyline points="6 9 12 15 18 9" /></svg>
                  )}
                </span>
                {showTesterAssign && isManager && (
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-md shadow-lg border z-30" style={{ minWidth: '160px', borderColor: '#DDD6FE' }}>
                    <div className="px-3 py-2 text-xs font-medium" style={{ color: '#6B7280', borderBottom: '1px solid #F0F0F0' }}>分配测试者</div>
                    {allUsers.filter(u => !MANAGER_USERNAMES.includes(u.username)).map(u => (
                      <button
                        key={u.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                        style={{ color: u.id === tester.id ? '#8B5CF6' : '#333', fontWeight: u.id === tester.id ? 'bold' : 'normal' }}
                        onClick={() => { onAssignTester(form.id, u.id); setShowTesterAssign(false); }}
                      >
                        {u.username} {u.id === tester.id && '✓'}
                      </button>
                    ))}
                    {tester && (
                      <button
                        className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 transition-colors border-t"
                        style={{ color: '#EF4444' }}
                        onClick={() => {
                          onRemoveTesterAssignment(form.id);
                          setShowTesterAssign(false);
                        }}
                      >
                        取消分配
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {(tester?.name || form.executor) && (
          <div className="mt-1 text-xs" style={{ color: '#6B7280' }}>
            用例执行者: <span className="font-medium" style={{ color: '#374151' }}>{tester?.name || form.executor}</span>
          </div>
        )}
      </div>

      {/* ============ Main Detail Card ============ */}
      <div className="rounded-lg border mb-3 overflow-hidden" style={{ borderColor: '#D1D5DB' }}>
        {isManager && !editingMode && (
          <div className="px-4 py-1.5 text-xs flex items-center gap-1.5" style={{ color: '#9CA3AF', borderBottom: '1px solid #F0F0F0', backgroundColor: '#F9FAFB' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            基础信息只读，点击上方「用例修改」按钮可编辑
          </div>
        )}
        <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '80px' }} />
            <col />
            <col style={{ width: '80px' }} />
            <col />
          </colgroup>
          <tbody>
            {/* Row 1: 项目 | 特性 */}
            <tr style={{ borderBottom: '1px solid #F0F0F0' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0' }}>项目</td>
              <td className="px-3 py-2 text-sm" style={{ color: '#374151', backgroundColor: '#F3F4F6', borderRight: '1px solid #F0F0F0' }}>{form.project_name}</td>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0' }}>特性</td>
              <td className="px-2 py-1.5" style={{ backgroundColor: 'transparent' }}>
                <input type="text" value={form.feature || ''}
                  onChange={(e) => handleFieldChange('feature', e.target.value)}
                  readOnly={!canEditCore}
                  className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1"
                  style={readOnlyInputStyle(canEditCore)}
                  onFocus={(e) => { if (canEditCore) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } }}
                  onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; }}
                  placeholder="测试特性名称"
                />
              </td>
            </tr>
            {/* Row 2: 测试类别 | 特征 */}
            <tr style={{ borderBottom: '1px solid #F0F0F0' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0' }}>测试类别</td>
              <td className="px-2 py-1.5" style={{ backgroundColor: 'transparent', borderRight: '1px solid #F0F0F0' }}>
                <input type="text" value={form.test_category || ''}
                  onChange={(e) => handleFieldChange('test_category', e.target.value)}
                  readOnly={!canEditCore}
                  className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1"
                  style={readOnlyInputStyle(canEditCore)}
                  onFocus={(e) => { if (canEditCore) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } }}
                  onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; }}
                  placeholder="功能测试/性能测试/..."
                />
              </td>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0' }}>特征</td>
              <td className="px-2 py-1.5" style={{ backgroundColor: 'transparent' }}>
                <input type="text" value={form.trait || ''}
                  onChange={(e) => handleFieldChange('trait', e.target.value)}
                  readOnly={!canEditCore}
                  className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1"
                  style={readOnlyInputStyle(canEditCore)}
                  onFocus={(e) => { if (canEditCore) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } }}
                  onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; }}
                  placeholder="测试特征描述"
                />
              </td>
            </tr>
            {/* Row 3: 编号 | 用例名称 (spans 3 cols) */}
            <tr style={{ borderBottom: '1px solid #F0F0F0' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0' }}>编号</td>
              <td className="px-2 py-1.5" style={{ backgroundColor: 'transparent', borderRight: '1px solid #F0F0F0' }}>
                <input type="text" value={form.case_no || ''}
                  onChange={(e) => handleFieldChange('case_no', e.target.value)}
                  readOnly={!canEditCore}
                  className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1"
                  style={readOnlyInputStyle(canEditCore)}
                  onFocus={(e) => { if (canEditCore) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } }}
                  onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; }}
                  placeholder="用例编号"
                />
              </td>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0' }}>
                用例名称 <span style={{ color: '#EF4444' }}>*</span>
              </td>
              <td className="px-2 py-1.5" style={{ backgroundColor: 'transparent' }}>
                <input type="text" value={form.case_name || ''}
                  onChange={(e) => handleFieldChange('case_name', e.target.value)}
                  readOnly={!canEditCore}
                  className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1"
                  style={readOnlyInputStyle(canEditCore)}
                  onFocus={(e) => { if (canEditCore) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } }}
                  onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; }}
                />
              </td>
            </tr>
            {/* Row 4: 灯光 | 温度 */}
            <tr style={{ borderBottom: '1px solid #F0F0F0' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0' }}>灯光</td>
              <td className="px-2 py-1.5" style={{ backgroundColor: 'transparent', borderRight: '1px solid #F0F0F0' }}>
                <input type="text" value={form.light || ''}
                  onChange={(e) => handleFieldChange('light', e.target.value)}
                  readOnly={!canEditCore}
                  className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1"
                  style={readOnlyInputStyle(canEditCore)}
                  onFocus={(e) => { if (canEditCore) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } }}
                  onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; }}
                  placeholder="灯光设置"
                />
              </td>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0' }}>温度</td>
              <td className="px-2 py-1.5" style={{ backgroundColor: 'transparent' }}>
                <input type="text" value={form.temperature || ''}
                  onChange={(e) => handleFieldChange('temperature', e.target.value)}
                  readOnly={!canEditCore}
                  className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1"
                  style={readOnlyInputStyle(canEditCore)}
                  onFocus={(e) => { if (canEditCore) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } }}
                  onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; }}
                  placeholder="温度设置"
                />
              </td>
            </tr>
            {/* Row 5: 测试环境 (full width) */}
            <tr style={{ borderBottom: '1px solid #F0F0F0' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap align-top" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0', paddingTop: '10px' }}>测试环境</td>
              <td colSpan={3} className="px-2 py-1" style={{ backgroundColor: 'transparent' }}>
                <AutoResizeTextarea value={form.test_env || ''} onChange={(v: string) => handleFieldChange('test_env', v)} placeholder="测试相关设备" readOnly={!canEditCore} style={readOnlyTextareaStyle(canEditCore)} />
              </td>
            </tr>
            {/* Row 5: 前置操作 (full width) */}
            <tr style={{ borderBottom: '1px solid #F0F0F0' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap align-top" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0', paddingTop: '10px' }}>前置操作</td>
              <td colSpan={3} className="px-2 py-1" style={{ backgroundColor: 'transparent' }}>
                <AutoResizeTextarea value={form.pre_operation || ''} onChange={(v: string) => handleFieldChange('pre_operation', v)} placeholder="测试前置操作步骤" readOnly={!canEditCore} style={readOnlyTextareaStyle(canEditCore)} />
              </td>
            </tr>
            {/* Row 6: 测试步骤 (full width) */}
            <tr style={{ borderBottom: '1px solid #F0F0F0' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap align-top" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0', paddingTop: '10px' }}>测试步骤</td>
              <td colSpan={3} className="px-2 py-1" style={{ backgroundColor: 'transparent' }}>
                <AutoResizeTextarea value={form.step || ''} onChange={(v: string) => handleFieldChange('step', v)} placeholder="详细的测试执行步骤" readOnly={!canEditCore} style={readOnlyTextareaStyle(canEditCore)} />
              </td>
            </tr>
            {/* Row 7: 预期结果 (full width) */}
            <tr style={{ borderBottom: '1px solid #F0F0F0' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap align-top" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0', paddingTop: '10px' }}>预期结果</td>
              <td colSpan={3} className="px-2 py-1" style={{ backgroundColor: 'transparent' }}>
                <AutoResizeTextarea value={form.expect_result || ''} onChange={(v: string) => handleFieldChange('expect_result', v)} placeholder="测试预期结果" readOnly={!canEditCore} style={readOnlyTextareaStyle(canEditCore)} />
              </td>
            </tr>
            {/* Row 8: 备注 (full width) */}
            <tr>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap align-top" style={{ color: '#6B7280', backgroundColor: '#FAFBFC', borderRight: '1px solid #F0F0F0', paddingTop: '10px' }}>备注</td>
              <td colSpan={3} className="px-2 py-1" style={{ backgroundColor: 'transparent' }}>
                <AutoResizeTextarea value={form.note || ''} onChange={(v: string) => handleFieldChange('note', v)} placeholder="补充说明" readOnly={!canEditCore} style={readOnlyTextareaStyle(canEditCore)} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ============ Result Sub Card (visually separated) ============ */}
      <div className="rounded-lg border mb-4 overflow-hidden" style={{ borderColor: '#D1D5DB', backgroundColor: '#FAFBFC' }}>
        <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '80px' }} />
            <col />
            <col style={{ width: '80px' }} />
            <col />
          </colgroup>
          <tbody>
            {/* Row 1: 测试设备 (full width) */}
            <tr style={{ borderBottom: '1px solid #E8E8E8' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#F5F5F5', borderRight: '1px solid #E8E8E8' }}>测试设备</td>
              <td colSpan={3} className="px-2 py-1.5" style={{ backgroundColor: 'transparent' }}>
                <input type="text" value={form.test_device || ''}
                  onChange={(e) => handleFieldChange('test_device', e.target.value)}
                  readOnly={!canEditResult}
                  className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1"
                  style={readOnlyInputStyle(canEditResult)}
                  onFocus={(e) => { if (canEditResult) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } }}
                  onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; }}
                  placeholder="测试设备型号、配置等"
                />
              </td>
            </tr>
            {/* Row 2: 测试结果 | JIRA链接 */}
            <tr style={{ borderBottom: '1px solid #E8E8E8' }}>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#F5F5F5', borderRight: '1px solid #E8E8E8' }}>
                测试结果 <span style={{ color: '#EF4444' }}>*</span>
              </td>
              <td className="px-2 py-1.5" style={{ backgroundColor: canEditResult ? (form.test_result === 'Fail' ? '#FEF2F2' : form.test_result === 'Pass' ? '#F0FFF4' : 'transparent') : 'transparent', borderRight: '1px solid #E8E8E8' }}>
                <select value={form.test_result || ''}
                  onChange={(e) => handleFieldChange('test_result', e.target.value)}
                  disabled={!canEditResult}
                  className="w-full px-2 py-1 border rounded text-sm focus:outline-none"
                  style={{
                    borderColor: 'transparent',
                    color: form.test_result === 'Fail' ? '#DC2626' : form.test_result === 'Pass' ? '#16A34A' : '#1F2937',
                    backgroundColor: 'transparent',
                    cursor: canEditResult ? 'pointer' : 'default',
                  }}
                >
                  <option value="">请选择</option>
                  <option value="Pass">Pass</option>
                  <option value="Fail">Fail</option>
                  <option value="Block">Block</option>
                </select>
              </td>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: '#6B7280', backgroundColor: '#F5F5F5', borderRight: '1px solid #E8E8E8' }}>
                JIRA链接
              </td>
              <td className="px-2 py-1.5" style={{ backgroundColor: canEditResult ? (form.test_result === 'Fail' && !form.jira_link.trim() ? '#FFFBFB' : 'transparent') : 'transparent' }}>
                <div className="flex items-center gap-1 w-full" style={{ minHeight: '28px' }}>
                  {canEditResult && form.jira_link && /^https?:\/\/.+/.test(form.jira_link.trim()) && !editingJira ? (
                    <>
                      <a href={form.jira_link} target="_blank" rel="noopener noreferrer"
                        className="hover:underline truncate text-sm" style={{ color: '#0073E6', maxWidth: 'calc(100% - 24px)' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {form.jira_link}
                      </a>
                      <button type="button" className="p-0.5 rounded hover:bg-gray-100 flex-shrink-0"
                        onClick={() => setEditingJira(true)} title="修改链接"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                      </button>
                    </>
                  ) : (
                    <input type="text" value={form.jira_link || ''}
                      onChange={(e) => handleFieldChange('jira_link', e.target.value)}
                      readOnly={!canEditResult}
                      className="flex-1 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1"
                      style={{ borderColor: jiraLinkError ? '#EF4444' : 'transparent', color: '#1F2937', backgroundColor: jiraLinkError ? '#FFF5F5' : 'transparent', minHeight: '28px', boxSizing: 'border-box', minWidth: '0', cursor: canEditResult ? 'text' : 'default', boxShadow: jiraLinkError ? '0 0 0 2px rgba(239,68,68,0.1)' : 'none' }}
                      onFocus={(e) => { if (canEditResult) { if (!jiraLinkError) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } } }}
                      onBlur={(e) => {
                        if (!jiraLinkError) { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; }
                        if (canEditResult && form.jira_link && /^https?:\/\/.+/.test(form.jira_link.trim())) setEditingJira(false);
                      }}
                      placeholder={form.test_result === 'Fail' ? '建议填写JIRA链接' : 'https://...'}
                    />
                  )}
                  {canEditResult && form.test_result === 'Fail' && !form.jira_link.trim() && (
                    <span className="flex-shrink-0 text-xs" style={{ color: '#EF4444' }}>建议</span>
                  )}
                </div>
              </td>
            </tr>
            {/* Row 3: 测试备注 (full width textarea) */}
            <tr>
              <td className="px-3 py-2 text-xs font-medium whitespace-nowrap align-top" style={{ color: '#6B7280', backgroundColor: '#F5F5F5', borderRight: '1px solid #E8E8E8', paddingTop: '10px' }}>测试备注</td>
              <td colSpan={3} className="px-2 py-1" style={{ backgroundColor: 'transparent' }}>
                <AutoResizeTextarea value={form.test_result_note || ''} onChange={(v: string) => handleFieldChange('test_result_note', v)} placeholder="测试备注、评论" readOnly={!canEditResult} style={readOnlyTextareaStyle(canEditResult)} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ============ Test Process & Logs Section ============ */}
      <div className="rounded-lg border p-4 mb-4" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full" style={{ backgroundColor: '#8B5CF6' }} />
            <span className="text-sm font-semibold" style={{ color: '#374151' }}>测试过程及日志</span>
          </div>
          <div className="flex items-center gap-2">
            {canEditResult && (
            <label
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs cursor-pointer transition-colors"
              style={{ backgroundColor: '#0073E6', color: '#FFF' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              上传文件
              <input type="file" multiple className="hidden"
                onChange={(e) => { if (e.target.files && e.target.files.length > 0) handleFileUpload(e.target.files); e.target.value = ''; }}
                disabled={uploading}
              />
            </label>
            )}
          </div>
        </div>

        {/* Upload Progress */}
        {uploadProgress.active && (
          <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-md" style={{ backgroundColor: '#F0F7FF', border: '1px solid #B3D9FF' }}>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: '#0073E6' }}>{uploadProgress.label}</span>
                <span className="text-xs font-medium" style={{ color: '#0073E6' }}>{uploadProgress.percent}%</span>
              </div>
              <div className="w-full h-1.5 bg-white rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${uploadProgress.percent}%`, backgroundColor: '#0073E6' }} />
              </div>
            </div>
          </div>
        )}

        {/* Rich Text Editor */}
        <RichTextEditor
          value={form.test_log || ''}
          onChange={(html: string) => handleFieldChange('test_log', html)}
          caseId={form.id}
          preOperation={form.pre_operation || ''}
          step={form.step || ''}
        />

        {/* File List */}
        {displayFiles.length > 0 && (
          <div className="mt-3 space-y-1">
            {displayFiles.map(file => (
              <div key={file.id}
                className="flex items-center justify-between px-3 py-1.5 border rounded group cursor-pointer transition-all duration-150"
                style={{ borderColor: '#E5E7EB' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0073E6'; e.currentTarget.style.backgroundColor = '#F0F7FF'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.backgroundColor = ''; }}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" className="flex-shrink-0">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  {renamingFile?.id === file.id ? (
                    <input autoFocus className="text-xs px-1 border rounded flex-1"
                      style={{ borderColor: '#0073E6', outline: 'none', minWidth: '0' }}
                      value={renamingFile.name}
                      onChange={(e) => setRenamingFile({ ...renamingFile, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFile(file.id, renamingFile.name); if (e.key === 'Escape') setRenamingFile(null); }}
                      onBlur={() => handleRenameFile(file.id, renamingFile.name)}
                    />
                  ) : (
                    <span
                      className="text-xs truncate hover:underline"
                      style={{ color: '#0073E6', cursor: 'pointer' }}
                      title="点击下载"
                      onClick={() => { const a = document.createElement('a'); a.href = `/api/files/${file.id}`; a.download = file.original_name; a.click(); }}
                    >{file.original_name}</span>
                  )}
                  <span className="text-xs flex-shrink-0" style={{ color: '#9CA3AF' }}>{formatFileSize(file.file_size)}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {(isImageFile(file.file_type) || isTextFile(file.file_type)) && (
                    <button type="button" className="p-1 rounded hover:bg-gray-100" title="预览"
                      onClick={() => handlePreviewFile(file.id, file.file_type)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    </button>
                  )}
                  <button type="button" className="p-1 rounded hover:bg-gray-100" title="下载"
                    onClick={() => { const a = document.createElement('a'); a.href = `/api/files/${file.id}`; a.download = file.original_name; a.click(); }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  </button>
                  {canEditResult && (
                    <>
                      <button type="button" className="p-1 rounded hover:bg-gray-100" title="重命名"
                        onClick={() => setRenamingFile({ id: file.id, name: file.original_name })}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                      </button>
                      <button type="button" className="p-1 rounded hover:bg-red-50" title="删除"
                        onClick={() => handleDeleteFile(file.id)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Buttons */}
      <div className="flex justify-end gap-2">
        {canEditResult && !editingMode && (
          <button
            onClick={() => handleSave('result')}
            disabled={saving}
            className="px-6 py-2 text-white rounded-md text-sm font-medium transition-all disabled:opacity-60"
            style={{ backgroundColor: '#0073E6', boxShadow: saving ? 'none' : '0 1px 2px rgba(0,115,230,0.2)' }}
            onMouseOver={(e) => { if (!saving) e.currentTarget.style.backgroundColor = '#0062CC'; }}
            onMouseOut={(e) => { if (!saving) e.currentTarget.style.backgroundColor = '#0073E6'; }}
          >
            {saving ? '保存中...' : '结果保存'}
          </button>
        )}
      </div>

    </div>
  );
}

// ============ User Management Dialog ============
function UserManagementDialog({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadUsers = async () => {
    const res = await fetch('/api/users');
    const data = await res.json();
    if (data.users) setUsers(data.users);
  };

  useEffect(() => {
    loadUsers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!newUsername.trim() || !newPassword) {
      setMessage({ type: 'error', text: '请输入用户名和密码' });
      return;
    }
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername.trim(), password: newPassword }),
    });
    const data = await res.json();
    if (data.success) {
      setShowAdd(false);
      setNewUsername('');
      setNewPassword('');
      loadUsers();
      setMessage({ type: 'success', text: '用户创建成功' });
    } else {
      setMessage({ type: 'error', text: data.error || '创建失败' });
    }
    setTimeout(() => setMessage(null), 1000);
  };

  const handleDelete = async (userId: number) => {
    if (!confirm('确定要删除此用户吗？删除后该用户的所有数据将一并删除。')) return;
    const res = await fetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (data.success) {
      loadUsers();
      setMessage({ type: 'success', text: '用户已删除' });
    } else {
      setMessage({ type: 'error', text: data.error || '删除失败' });
    }
    setTimeout(() => setMessage(null), 1000);
  };

  const handleResetPassword = async (userId: number) => {
    if (!confirm('确定要重置此用户的密码为111111吗？')) return;
    const res = await fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage({ type: 'success', text: '密码已重置为111111' });
    } else {
      setMessage({ type: 'error', text: data.error || '重置失败' });
    }
    setTimeout(() => setMessage(null), 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#EEEEEE' }}>
          <h2 className="font-bold" style={{ color: '#333' }}>用户管理</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="px-6 py-4 overflow-auto" style={{ maxHeight: '60vh' }}>
          {message && (
            <div className="mb-3 px-3 py-2 rounded-md text-sm" style={{
              backgroundColor: message.type === 'success' ? '#F0FFF4' : '#FFF5F5',
              color: message.type === 'success' ? '#22C55E' : '#EF4444',
            }}>
              {message.text}
            </div>
          )}

          {/* Add user */}
          {!showAdd ? (
            <button
              onClick={() => setShowAdd(true)}
              className="mb-4 px-3 py-1.5 rounded-md text-sm transition-colors"
              style={{ backgroundColor: '#0073E6', color: '#FFFFFF' }}
            >
              新增用户
            </button>
          ) : (
            <div className="mb-4 p-3 border rounded-md" style={{ borderColor: '#EEEEEE' }}>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="用户名"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="flex-1 px-2 py-1.5 border rounded-md text-sm"
                  style={{ borderColor: '#EEEEEE' }}
                />
                <input
                  type="password"
                  placeholder="密码（至少6位）"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="flex-1 px-2 py-1.5 border rounded-md text-sm"
                  style={{ borderColor: '#EEEEEE' }}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAdd} className="px-3 py-1 rounded-md text-sm text-white" style={{ backgroundColor: '#0073E6' }}>确定</button>
                <button onClick={() => { setShowAdd(false); setNewUsername(''); setNewPassword(''); }} className="px-3 py-1 rounded-md text-sm border" style={{ borderColor: '#EEEEEE', color: '#666' }}>取消</button>
              </div>
            </div>
          )}

          {/* User list */}
          <div className="space-y-1">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between px-3 py-2 border rounded-md" style={{ borderColor: '#EEEEEE' }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: '#333' }}>{u.username}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: u.role === 'admin' ? '#E6F2FF' : '#F0F0F0', color: u.role === 'admin' ? '#0073E6' : '#666' }}>
                    {u.role === 'admin' ? '管理员' : '普通用户'}
                  </span>
                </div>
                {u.role !== 'admin' && (
                  <div className="flex gap-1">
                    <button onClick={() => handleResetPassword(u.id)} className="px-2 py-0.5 text-xs rounded hover:bg-gray-100" style={{ color: '#0073E6' }}>
                      重置密码
                    </button>
                    <button onClick={() => handleDelete(u.id)} className="px-2 py-0.5 text-xs rounded hover:bg-red-50" style={{ color: '#EF4444' }}>
                      删除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Change Password Dialog ============
function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async () => {
    if (!oldPwd || !newPwd || !confirmPwd) {
      setMessage({ type: 'error', text: '请填写所有字段' });
      return;
    }
    if (newPwd.length < 6) {
      setMessage({ type: 'error', text: '新密码长度不能少于6位' });
      return;
    }
    if (newPwd !== confirmPwd) {
      setMessage({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage({ type: 'success', text: '密码修改成功' });
      setTimeout(onClose, 1500);
    } else {
      setMessage({ type: 'error', text: data.error || '修改失败' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#EEEEEE' }}>
          <h2 className="font-bold" style={{ color: '#333' }}>修改密码</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          {message && (
            <div className="px-3 py-2 rounded-md text-sm" style={{
              backgroundColor: message.type === 'success' ? '#F0FFF4' : '#FFF5F5',
              color: message.type === 'success' ? '#22C55E' : '#EF4444',
            }}>
              {message.text}
            </div>
          )}
          <div>
            <label className="block text-sm mb-1" style={{ color: '#333' }}>原密码</label>
            <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} className="w-full px-3 py-2 border rounded-md text-sm" style={{ borderColor: '#EEEEEE' }} />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: '#333' }}>新密码（至少6位）</label>
            <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="w-full px-3 py-2 border rounded-md text-sm" style={{ borderColor: '#EEEEEE' }} />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: '#333' }}>确认新密码</label>
            <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} className="w-full px-3 py-2 border rounded-md text-sm" style={{ borderColor: '#EEEEEE' }} />
          </div>
          <button onClick={handleSubmit} className="w-full py-2 text-white rounded-md text-sm" style={{ backgroundColor: '#0073E6' }}>确认修改</button>
        </div>
      </div>
    </div>
  );
}

// ============ Storage Settings Dialog ============
function StorageSettingsDialog({ onClose }: { onClose: () => void }) {
  const [storagePath, setStoragePath] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(d => { if (d.storagePath) setStoragePath(d.storagePath); });
  }, []);

  const handleSave = async () => {
    if (!storagePath.trim()) {
      setMessage({ type: 'error', text: '请输入存储路径' });
      return;
    }
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath: storagePath.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage({ type: 'success', text: '存储路径已更新' });
      setTimeout(onClose, 1500);
    } else {
      setMessage({ type: 'error', text: data.error || '更新失败' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#EEEEEE' }}>
          <h2 className="font-bold" style={{ color: '#333' }}>存储设置</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="px-6 py-4">
          {message && (
            <div className="mb-3 px-3 py-2 rounded-md text-sm" style={{
              backgroundColor: message.type === 'success' ? '#F0FFF4' : '#FFF5F5',
              color: message.type === 'success' ? '#22C55E' : '#EF4444',
            }}>
              {message.text}
            </div>
          )}
          <label className="block text-sm mb-1.5" style={{ color: '#333' }}>文件存储路径</label>
          <input
            type="text"
            value={storagePath}
            onChange={(e) => setStoragePath(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm"
            style={{ borderColor: '#EEEEEE' }}
            placeholder="例如：C:\Users\admin\Desktop\测试数据"
          />
          <p className="text-xs mt-2" style={{ color: '#999' }}>上传的测试文件将保存到此路径。修改后新上传的文件将使用新路径。</p>
          <button onClick={handleSave} className="w-full py-2 text-white rounded-md text-sm mt-4" style={{ backgroundColor: '#0073E6' }}>保存设置</button>
        </div>
      </div>
    </div>
  );
}

// ============ File Preview Dialog ============
function FilePreviewDialog({
  content,
  filename,
  truncated,
  fileId,
  isImage,
  onClose,
}: {
  content: string;
  filename: string;
  truncated: boolean;
  fileId: number;
  isImage?: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }} onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4" style={{ maxHeight: '85vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#EEEEEE' }}>
          <h2 className="font-bold text-sm" style={{ color: '#333' }}>预览：{filename}</h2>
          <div className="flex items-center gap-2">
            <a
              href={`/api/files/${fileId}`}
              className="px-2 py-0.5 text-xs rounded hover:bg-gray-100"
              style={{ color: '#0073E6' }}
            >
              下载
            </a>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>
        <div className="px-6 py-4 overflow-auto" style={{ maxHeight: '70vh' }}>
          {isImage ? (
            <div className="flex items-center justify-center">
              <img
                src={`/api/files/preview/${fileId}`}
                alt={filename}
                style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }}
              />
            </div>
          ) : (
            <>
              <pre className="text-sm whitespace-pre-wrap break-words" style={{ color: '#333', lineHeight: '1.6', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                {content}
              </pre>
              {truncated && (
                <p className="text-xs mt-2" style={{ color: '#999' }}>文件内容过长，仅显示前50000字符。请下载查看完整内容。</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Auto-Resize Textarea ============
function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  textareaRef: externalRef,
  readOnly,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  readOnly?: boolean;
  style?: React.CSSProperties;
}) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef || internalRef;

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      // Shrink first to measure true content height, then set to scrollHeight
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      className="w-full px-2.5 py-1.5 border rounded text-sm focus:outline-none overflow-hidden"
      style={{
        borderColor: readOnly ? 'transparent' : '#E5E7EB',
        color: '#1F2937',
        lineHeight: '1.6',
        minHeight: '32px',
        ...style,
      }}
      onFocus={(e) => { if (!readOnly) { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; } }}
      onBlur={(e) => { e.target.style.borderColor = readOnly ? 'transparent' : '#E5E7EB'; e.target.style.boxShadow = 'none'; }}
      placeholder={placeholder}
    />
  );
}

// ============ Synced Textarea Row ============
// Two textareas in a 3:2 grid row. Heights sync to the taller one on content change.
// No ResizeObserver — synced purely via useEffect on value changes to avoid feedback loops.
function SyncedTextareaRow({
  leftLabel,
  leftValue,
  leftOnChange,
  leftPlaceholder,
  rightLabel,
  rightValue,
  rightOnChange,
  rightPlaceholder,
}: {
  leftLabel: string;
  leftValue: string;
  leftOnChange: (v: string) => void;
  leftPlaceholder?: string;
  rightLabel: string;
  rightValue: string;
  rightOnChange: (v: string) => void;
  rightPlaceholder?: string;
}) {
  const leftRef = useRef<HTMLTextAreaElement>(null);
  const rightRef = useRef<HTMLTextAreaElement>(null);

  // After each value change, let each textarea auto-resize, then sync to the taller height
  useEffect(() => {
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;
    if (!leftEl || !rightEl) return;

    // First, let each textarea auto-resize independently (shrink then grow to content)
    leftEl.style.height = 'auto';
    const leftH = leftEl.scrollHeight;
    rightEl.style.height = 'auto';
    const rightH = rightEl.scrollHeight;

    // Sync both to the taller one
    const maxH = Math.max(leftH, rightH);
    leftEl.style.height = maxH + 'px';
    rightEl.style.height = maxH + 'px';
  }, [leftValue, rightValue]);

  return (
    <div className="grid gap-x-4" style={{ gridTemplateColumns: '3fr 2fr' }}>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: '#6B7280' }}>{leftLabel}</label>
        </div>
        <AutoResizeTextarea value={leftValue} onChange={leftOnChange} placeholder={leftPlaceholder} textareaRef={leftRef} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: '#6B7280' }}>{rightLabel}</label>
        </div>
        <AutoResizeTextarea value={rightValue} onChange={rightOnChange} placeholder={rightPlaceholder} textareaRef={rightRef} />
      </div>
    </div>
  );
}

// ============ Rich Text Editor ============
function RichTextEditor({
  value,
  onChange,
  caseId,
  preOperation,
  step,
}: {
  value: string;
  onChange: (html: string) => void;
  caseId: number;
  preOperation: string;
  step: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ active: boolean; percent: number; label: string }>({ active: false, percent: 0, label: '' });
  const [imageViewing, setImageViewing] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePos, setImagePos] = useState({ x: 0, y: 0 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizingImg, setResizingImg] = useState<HTMLElement | null>(null);

  // Sync external value to editor
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      // Fix legacy image URLs: replace /api/files/ID with /api/files/preview/ID
      // Handles both relative (/api/files/ID) and absolute (https://domain/api/files/ID) URLs
      const fixedValue = value.replace(
        /(<img[^>]*src=["'])(?:https?:\/\/[^\/"']+)?(\/api\/files\/)(\d+)(["'][^>]*>)/g,
        '$1/api/files/preview/$3$4'
      );
      editorRef.current.innerHTML = fixedValue;
    }
  }, [value]);

  const execCommand = (command: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, val);
    onChange(editorRef.current?.innerHTML || '');
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        execCommand('bold');
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        execCommand('underline');
      }
    }
    if (e.key === 'Escape' && isFullscreen) {
      setIsFullscreen(false);
    }
  };

  // Upload image with progress tracking
  const uploadImageWithProgress = async (imageFile: File, label: string): Promise<{ url: string } | null> => {
    setUploadProgress({ active: true, percent: 0, label });
    try {
      return await new Promise<{ url: string } | null>((resolve) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('caseId', caseId.toString());
        formData.append('image', imageFile, `paste-${Date.now()}.png`);

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(prev => ({ ...prev, percent: pct }));
          }
        });

        xhr.addEventListener('load', () => {
          setUploadProgress({ active: false, percent: 0, label: '' });
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.success && data.url) {
              resolve({ url: data.url });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });

        xhr.addEventListener('error', () => {
          setUploadProgress({ active: false, percent: 0, label: '' });
          resolve(null);
        });

        xhr.open('POST', '/api/files/upload-image');
        xhr.send(formData);
      });
    } catch {
      setUploadProgress({ active: false, percent: 0, label: '' });
      return null;
    }
  };

  const insertImageToEditor = (url: string) => {
    const imgHtml = `<img src="${url}" style="max-width:45%;height:auto;margin:2px 4px;display:inline-block;vertical-align:bottom;cursor:se-resize;" class="editor-img" />`;
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, imgHtml);
    onChange(editorRef.current?.innerHTML || '');
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const imageFile = item.getAsFile();
        if (!imageFile) return;
        const result = await uploadImageWithProgress(imageFile, '粘贴截图中...');
        if (result) {
          insertImageToEditor(result.url);
        }
        return;
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const result = await uploadImageWithProgress(file, '上传截图中...');
      if (result) {
        insertImageToEditor(result.url);
      }
    }
    e.target.value = '';
  };

  // Handle image interactions in the editor
  const handleEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      // Single click - select the image but don't delete
      e.preventDefault();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNode(target);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };

  const handleEditorDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      e.preventDefault();
      let src = (target as HTMLImageElement).src;
      if (src) {
        // Fix legacy download URLs: convert /api/files/ID to /api/files/preview/ID
        // Handles both relative and absolute URLs
        src = src.replace(/\/api\/files\/(\d+)(\?[^/]*)?$/, '/api/files/preview/$1');
        setImageViewing(src);
        setImageZoom(1);
        setImagePos({ x: 0, y: 0 });
      }
    }
  };

  // Handle image resize by dragging edges
  const handleEditorMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      const rect = target.getBoundingClientRect();
      const edgeSize = 8;
      const isNearRight = Math.abs(e.clientX - rect.right) < edgeSize;
      const isNearBottom = Math.abs(e.clientY - rect.bottom) < edgeSize;
      if (isNearRight || isNearBottom) {
        e.preventDefault();
        setResizingImg(target);
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = target.offsetWidth;
        const startH = target.offsetHeight;

        const onMouseMove = (ev: MouseEvent) => {
          if (isNearRight) {
            const newW = Math.max(50, startW + (ev.clientX - startX));
            target.style.width = newW + 'px';
            target.style.height = 'auto';
          }
          if (isNearBottom) {
            const newH = Math.max(50, startH + (ev.clientY - startY));
            target.style.height = newH + 'px';
            target.style.width = 'auto';
          }
          onChange(editorRef.current?.innerHTML || '');
        };

        const onMouseUp = () => {
          setResizingImg(null);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }
    }
  };

  // Change cursor when hovering near image edges
  const handleEditorMouseMove = (e: React.MouseEvent) => {
    if (resizingImg) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      const rect = target.getBoundingClientRect();
      const edgeSize = 8;
      const isNearRight = Math.abs(e.clientX - rect.right) < edgeSize;
      const isNearBottom = Math.abs(e.clientY - rect.bottom) < edgeSize;
      if (isNearRight && isNearBottom) {
        (target as HTMLElement).style.cursor = 'nwse-resize';
      } else if (isNearRight) {
        (target as HTMLElement).style.cursor = 'ew-resize';
      } else if (isNearBottom) {
        (target as HTMLElement).style.cursor = 'ns-resize';
      } else {
        (target as HTMLElement).style.cursor = 'pointer';
      }
    }
  };

  // Import pre-operation + step into editor
  const handleImportStep = () => {
    let content = '';
    if (preOperation.trim()) {
      content += `<b>前置操作：</b><br/>${preOperation.trim().replace(/\n/g, '<br/>')}<br/><br/>`;
    }
    if (step.trim()) {
      content += `<b>测试步骤：</b><br/>${step.trim().replace(/\n/g, '<br/>')}`;
    }
    if (!content.trim()) return;
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, content);
    onChange(editorRef.current?.innerHTML || '');
  };

  // Image viewer zoom controls
  const handleImageWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setImageZoom(prev => Math.min(5, Math.max(0.1, prev + delta)));
  };

  const handleImageDragStart = (e: React.MouseEvent) => {
    if (imageZoom > 1) {
      setIsDraggingImage(true);
      setDragStart({ x: e.clientX - imagePos.x, y: e.clientY - imagePos.y });
    }
  };

  const handleImageDrag = useCallback((e: MouseEvent) => {
    if (isDraggingImage) {
      setImagePos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  }, [isDraggingImage, dragStart]);

  const handleImageDragEnd = useCallback(() => {
    setIsDraggingImage(false);
  }, []);

  useEffect(() => {
    if (isDraggingImage) {
      document.addEventListener('mousemove', handleImageDrag);
      document.addEventListener('mouseup', handleImageDragEnd);
    }
    return () => {
      document.removeEventListener('mousemove', handleImageDrag);
      document.removeEventListener('mouseup', handleImageDragEnd);
    };
  }, [isDraggingImage, handleImageDrag, handleImageDragEnd]);

  const colors = [
    { label: '黑色', value: '#333333' },
    { label: '红色', value: '#EF4444' },
    { label: '绿色', value: '#22C55E' },
    { label: '蓝色', value: '#3B82F6' },
    { label: '橙色', value: '#F97316' },
    { label: '紫色', value: '#8B5CF6' },
  ];

  const toolbar = (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b flex-wrap" style={{ borderColor: '#EEEEEE', backgroundColor: '#FAFAFA' }}>
      <button type="button" className="px-2 py-1 rounded text-sm font-bold hover:bg-gray-200 transition-colors" style={{ color: '#333' }} onClick={() => execCommand('bold')} title="加粗 (Ctrl+B)">B</button>
      <button type="button" className="px-2 py-1 rounded text-sm hover:bg-gray-200 transition-colors" style={{ color: '#333', textDecoration: 'underline' }} onClick={() => execCommand('underline')} title="下划线 (Ctrl+U)">U</button>
      <div className="relative">
        <button type="button" className="px-2 py-1 rounded text-sm hover:bg-gray-200 transition-colors flex items-center gap-1" style={{ color: '#333' }} onClick={() => setColorPickerOpen(!colorPickerOpen)} title="文字颜色">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20h16" /><path d="M6 16l6-12 6 12" /></svg>
          <span>A</span>
        </button>
        {colorPickerOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setColorPickerOpen(false)} />
            <div className="absolute left-0 top-full mt-1 bg-white rounded-md shadow-lg border z-20 py-1" style={{ borderColor: '#EEEEEE', minWidth: '100px' }}>
              {colors.map(c => (
                <button key={c.value} type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2" onClick={() => { execCommand('foreColor', c.value); setColorPickerOpen(false); }}>
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: c.value }} />{c.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button type="button" className="px-2 py-1 rounded text-sm hover:bg-gray-200 transition-colors flex items-center gap-1" style={{ color: '#333' }} onClick={() => fileInputRef.current?.click()} title="上传本地图片">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
        上传图片
      </button>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
      <div className="w-px h-4 mx-1" style={{ backgroundColor: '#DDDDDD' }} />
      <button type="button" className="px-2 py-1 rounded text-sm hover:bg-gray-200 transition-colors flex items-center gap-1" style={{ color: '#0073E6' }} onClick={handleImportStep} title="导入前置操作和测试步骤到光标位置">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        导入步骤
      </button>
      <button type="button" className="px-2 py-1 rounded text-sm hover:bg-gray-200 transition-colors flex items-center gap-1" style={{ color: '#333' }} onClick={() => setIsFullscreen(!isFullscreen)} title={isFullscreen ? '退出全屏 (Esc)' : '全屏编辑'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {isFullscreen ? (
            <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>
          ) : (
            <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
          )}
        </svg>
        {isFullscreen ? '退出全屏' : '全屏'}
      </button>
      {uploadProgress.active && (
        <div className="flex items-center gap-2 ml-2">
          <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-200" style={{ width: `${uploadProgress.percent}%`, backgroundColor: '#0073E6' }} />
          </div>
          <span className="text-xs" style={{ color: '#666' }}>{uploadProgress.label} {uploadProgress.percent}%</span>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div
        className={isFullscreen ? 'fixed inset-0 z-50 flex flex-col' : 'border rounded-md overflow-hidden'}
        style={isFullscreen ? { backgroundColor: '#FFFFFF', borderColor: undefined } : { borderColor: '#EEEEEE' }}
      >
        {toolbar}
        <div
          ref={editorRef}
          contentEditable
          className="px-3 py-2 text-sm focus:outline-none"
          style={{ color: '#333', lineHeight: '1.8', minHeight: isFullscreen ? 'calc(100vh - 60px)' : '150px', maxHeight: isFullscreen ? 'calc(100vh - 60px)' : '500px', overflowY: 'auto' }}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onClick={handleEditorClick}
          onDoubleClick={handleEditorDoubleClick}
          onMouseDown={handleEditorMouseDown}
          onMouseMove={handleEditorMouseMove}
          data-placeholder="在此记录测试执行详情、问题描述、结果说明等。支持 Ctrl+V 粘贴截图，双击图片可放大查看，拖动图片边缘可调整大小..."
        />
      </div>

      {/* Image Viewer Overlay */}
      {imageViewing && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
          onClick={() => setImageViewing(null)}
          onWheel={handleImageWheel}
        >
          {/* Zoom controls */}
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-colors text-lg"
              onClick={(e) => { e.stopPropagation(); setImageZoom(prev => Math.min(5, prev + 0.25)); }}
              title="放大"
            >
              +
            </button>
            <span className="text-white text-sm min-w-[50px] text-center">{Math.round(imageZoom * 100)}%</span>
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-colors text-lg"
              onClick={(e) => { e.stopPropagation(); setImageZoom(prev => Math.max(0.1, prev - 0.25)); }}
              title="缩小"
            >
              -
            </button>
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-colors text-sm ml-2"
              onClick={(e) => { e.stopPropagation(); setImageZoom(1); setImagePos({ x: 0, y: 0 }); }}
              title="重置"
            >
              1:1
            </button>
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-colors ml-2"
              onClick={() => setImageViewing(null)}
              title="关闭"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          {/* Drag hint */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-xs z-10">
            滚轮缩放 | 拖拽移动 | 点击空白处关闭
          </div>
          <img
            src={imageViewing}
            alt="预览"
            className="max-w-none select-none"
            style={{
              transform: `scale(${imageZoom}) translate(${imagePos.x / imageZoom}px, ${imagePos.y / imageZoom}px)`,
              transition: isDraggingImage ? 'none' : 'transform 0.15s ease',
              cursor: imageZoom > 1 ? (isDraggingImage ? 'grabbing' : 'grab') : 'default',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => { e.preventDefault(); handleImageDragStart(e); }}
            draggable={false}
          />
        </div>
      )}
    </>
  );
}

// ============ Stats Preview Modal ============
const CHART_COLORS = {
  passed: '#22C55E',
  failed: '#EF4444',
  incomplete: '#9CA3AF',
  blue: '#0073E6',
  lightBlue: '#60A5FA',
  purple: '#8B5CF6',
  orange: '#F97316',
};

// Custom pie label renderer with anti-overlap
interface PieLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  name: string;
  value: number;
  index: number;
}

const PIE_LABEL_PLACED: Array<{ x: number; y: number; height: number }> = [];

function renderAntiOverlapPieLabel(props: PieLabelProps) {
  const { cx, cy, midAngle, outerRadius, percent, name } = props;
  const RADIAN = Math.PI / 180;

  // Only show label if slice has some visibility
  if (percent < 0.005) return null;

  const labelRadius = outerRadius + 24;
  const x = cx + labelRadius * Math.cos(-midAngle * RADIAN);
  const y = cy + labelRadius * Math.sin(-midAngle * RADIAN);

  const text = `${name} ${(percent * 100).toFixed(1)}%`;
  const lineHeight = 14;
  const estimatedHeight = lineHeight;

  // Anti-overlap: check and adjust y position
  let adjustedY = y;
  for (const placed of PIE_LABEL_PLACED) {
    if (Math.abs(adjustedY - placed.y) < estimatedHeight && Math.abs(x - placed.x) < 100) {
      adjustedY = placed.y + estimatedHeight;
    }
  }

  PIE_LABEL_PLACED.push({ x, y: adjustedY, height: estimatedHeight });

  // Determine if label is on the right or left side
  const isRightSide = x >= cx;
  const textAnchor = isRightSide ? 'start' : 'end';
  const labelX = isRightSide ? x + 2 : x - 2;

  // Leader line: from pie edge to label
  const pieEdgeX = cx + (outerRadius + 4) * Math.cos(-midAngle * RADIAN);
  const pieEdgeY = cy + (outerRadius + 4) * Math.sin(-midAngle * RADIAN);
  const elbowX = isRightSide ? x + 2 : x - 2;

  const fontSize = percent < 0.05 ? 9 : percent < 0.1 ? 10 : 11;

  return (
    <g>
      <polyline
        points={`${pieEdgeX},${pieEdgeY} ${elbowX},${adjustedY}`}
        fill="none"
        stroke="#9CA3AF"
        strokeWidth={0.8}
      />
      <text
        x={labelX}
        y={adjustedY}
        textAnchor={textAnchor}
        dominantBaseline="middle"
        fontSize={fontSize}
        fill="#374151"
      >
        {text}
      </text>
    </g>
  );
}

interface StatsSummary {
  total: number;
  completed: number;
  incomplete: number;
  passed: number;
  failed: number;
  blocked: number;
  completionRate: number;
  passRate: number;
  completedPassRate: number;
  blockedRate: number;
}

interface ModuleStat {
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
  completedPassRate: number;
  blockedRate: number;
}

interface CaseStat {
  id: number;
  case_name: string;
  test_result: string | null;
  priority: string;
  status: 'passed' | 'failed' | 'blocked' | 'incomplete';
}

function StatsPreviewModal({
  level,
  id,
  name,
  onClose,
  onNavigateCase,
  onNavigateModule,
}: {
  level: 'project' | 'module';
  id: number;
  name: string;
  onClose: () => void;
  onNavigateCase: (caseId: number) => void;
  onNavigateModule: (moduleId: number) => void;
}) {
  const [data, setData] = useState<{
    summary: StatsSummary;
    modules?: ModuleStat[];
    cases?: CaseStat[];
    name?: string;
    jiraLinks?: Array<{ link: string; cases: Array<{ id: number; case_name: string; test_result: string | null; module_name: string }> }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'completionRate' | 'passRate' | 'failed' | 'blocked'>('completionRate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [caseFilter, setCaseFilter] = useState<'all' | 'failed' | 'blocked' | 'incomplete'>('all');
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]); // [] means all

  const togglePriority = (p: string) => {
    setSelectedPriorities(prev => {
      if (prev.includes(p)) return prev.filter(x => x !== p);
      return [...prev, p];
    });
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ level, id: id.toString() });
        if (selectedPriorities.length > 0) {
          params.set('priorities', selectedPriorities.join(','));
        }
        const res = await fetch(`/api/stats/preview?${params.toString()}`);
        const json = await res.json();
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
        }
      } catch {
        setError('获取统计数据失败');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [level, id, selectedPriorities]);

  if (loading) {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <div className="bg-white rounded-xl p-8 shadow-2xl" style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: '#0073E6' }} />
            <span className="text-sm" style={{ color: '#666' }}>加载统计数据...</span>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  if (error || !data) {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
        <div className="bg-white rounded-xl p-6 shadow-2xl" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
          <p className="text-sm mb-4" style={{ color: '#EF4444' }}>{error || '数据加载失败'}</p>
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded" style={{ backgroundColor: '#0073E6', color: '#FFF' }}>关闭</button>
        </div>
      </div>,
      document.body
    );
  }

  const { summary } = data;
  const displayName = data.name || name;

  const completionPieData = [
    { name: '已完成', value: summary.completed, color: CHART_COLORS.blue },
    { name: '未完成', value: summary.incomplete, color: CHART_COLORS.incomplete },
  ].filter(d => d.value > 0);

  // Sort modules
  const sortedModules = level === 'project' && data.modules
    ? [...data.modules].sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
      })
    : [];

  // Filter cases
  const filteredCases = level === 'module' && data.cases
    ? data.cases.filter(c => caseFilter === 'all' || c.status === caseFilter)
    : [];

  // Module bar chart data - stacked segments summing to 100%
  const moduleBarData = data.modules
    ? data.modules.map(m => ({
        name: m.name,
        通过: m.total > 0 ? Math.round(m.passed / m.total * 1000) / 10 : 0,
        失败: m.total > 0 ? Math.round(m.failed / m.total * 1000) / 10 : 0,
        阻塞: m.total > 0 ? Math.round(m.blocked / m.total * 1000) / 10 : 0,
        未完成: m.total > 0 ? Math.round(m.incomplete / m.total * 1000) / 10 : 0,
        passCount: m.passed,
        failCount: m.failed,
        blockCount: m.blocked,
        incompleteCount: m.incomplete,
      }))
    : [];

  // Failed distribution pie
  const failedDistData = data.modules
    ? data.modules.filter(m => m.failed > 0).map(m => ({
        name: m.name,
        value: m.failed,
        color: [CHART_COLORS.failed, CHART_COLORS.orange, CHART_COLORS.purple, CHART_COLORS.blue, CHART_COLORS.lightBlue][data.modules!.filter(mm => mm.failed > 0).indexOf(m) % 5],
      }))
    : [];

  // Blocked distribution pie
  const blockedDistData = data.modules
    ? data.modules.filter(m => m.blocked > 0).map(m => ({
        name: m.name,
        value: m.blocked,
        color: [CHART_COLORS.orange, CHART_COLORS.purple, CHART_COLORS.blue, CHART_COLORS.lightBlue, CHART_COLORS.failed][data.modules!.filter(mm => mm.blocked > 0).indexOf(m) % 5],
      }))
    : [];

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ width: '960px', maxWidth: '95vw', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#E5E7EB' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1F2937' }}>
              {level === 'project' ? '项目' : '特性'}测试进度看板
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>{displayName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* ===== Priority Filter (Project Level Only) ===== */}
          {level === 'project' && (
            <div className="flex items-center gap-2 mb-4 pb-4 border-b" style={{ borderColor: '#E5E7EB' }}>
              <span className="text-xs font-medium" style={{ color: '#6B7280' }}>优先级筛选:</span>
              <button
                className="px-2.5 py-1 text-xs rounded border transition-colors"
                style={{
                  borderColor: selectedPriorities.length === 0 ? '#0073E6' : '#E5E7EB',
                  color: selectedPriorities.length === 0 ? '#0073E6' : '#6B7280',
                  backgroundColor: selectedPriorities.length === 0 ? '#F0F7FF' : 'transparent',
                }}
                onClick={() => setSelectedPriorities([])}
              >
                全部
              </button>
              {(['High', 'Middle', 'Low'] as const).map(p => (
                <button
                  key={p}
                  className="px-2.5 py-1 text-xs rounded border transition-colors"
                  style={{
                    borderColor: selectedPriorities.includes(p) ? '#0073E6' : '#E5E7EB',
                    color: selectedPriorities.includes(p) ? '#0073E6' : '#6B7280',
                    backgroundColor: selectedPriorities.includes(p) ? '#F0F7FF' : 'transparent',
                  }}
                  onClick={() => togglePriority(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* ===== Summary Cards ===== */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            <StatCard label="总用例数" value={summary.total} color="#0073E6" />
            <StatCard label="已完成" value={summary.completed} subtext={`${summary.completionRate}%`} color="#22C55E" />
            <StatCard label="Pass" value={summary.passed} subtext={`${summary.passRate}%`} color="#10B981" />
            <StatCard label="Fail" value={summary.failed} subtext={summary.total > 0 ? `${Math.round(summary.failed / summary.total * 1000) / 10}%` : '0%'} color="#EF4444" />
            <StatCard label="阻塞" value={summary.blocked} subtext={`${summary.blockedRate}%`} color="#F97316" />
          </div>

          {/* ===== Progress Bars ===== */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="rounded-lg border p-4" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: '#374151' }}>完成率</span>
                <span className="text-sm font-bold" style={{ color: '#0073E6' }}>{summary.completionRate}%</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${summary.completionRate}%`, backgroundColor: '#0073E6' }} />
              </div>
              <div className="flex justify-between mt-1 text-xs" style={{ color: '#9CA3AF' }}>
                <span>已完成 {summary.completed}</span>
                <span>未完成 {summary.incomplete}</span>
              </div>
            </div>
            <div className="rounded-lg border p-4" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: '#374151' }}>通过率</span>
                <span className="text-sm font-bold" style={{ color: '#22C55E' }}>{summary.passRate}%</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${summary.passRate}%`, backgroundColor: '#22C55E' }} />
              </div>
              <div className="flex justify-between mt-1 text-xs" style={{ color: '#9CA3AF' }}>
                <span>通过率 {summary.completedPassRate}%</span>
                <span>失败 {summary.failed}</span>
              </div>
            </div>
            <div className="rounded-lg border p-4" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: '#374151' }}>阻塞率</span>
                <span className="text-sm font-bold" style={{ color: '#F97316' }}>{summary.blockedRate}%</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${summary.blockedRate}%`, backgroundColor: '#F97316' }} />
              </div>
              <div className="flex justify-between mt-1 text-xs" style={{ color: '#9CA3AF' }}>
                <span>阻塞 {summary.blocked}</span>
                <span>总用例 {summary.total}</span>
              </div>
            </div>
          </div>

          {/* ===== Charts Row ===== */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Status Distribution Pie */}
            <div className="rounded-lg border p-4" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
              <h4 className="text-xs font-semibold mb-3" style={{ color: '#374151' }}>用例状态分布</h4>
              {summary.total > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={[
                      { name: '通过', value: summary.passed, color: CHART_COLORS.passed },
                      { name: '失败', value: summary.failed, color: CHART_COLORS.failed },
                      { name: '阻塞', value: summary.blocked, color: CHART_COLORS.orange },
                      { name: '未完成', value: summary.incomplete, color: CHART_COLORS.incomplete },
                    ].filter(d => d.value > 0)} cx="50%" cy="50%" outerRadius={80} innerRadius={45} dataKey="value"
                      label={(props: PieLabelProps) => { PIE_LABEL_PLACED.length = 0; return renderAntiOverlapPieLabel(props); }}
                      labelLine={false}>
                      {[
                        { name: '通过', value: summary.passed, color: CHART_COLORS.passed },
                        { name: '失败', value: summary.failed, color: CHART_COLORS.failed },
                        { name: '阻塞', value: summary.blocked, color: CHART_COLORS.orange },
                        { name: '未完成', value: summary.incomplete, color: CHART_COLORS.incomplete },
                      ].filter(d => d.value > 0).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[240px] text-xs" style={{ color: '#9CA3AF' }}>暂无数据</div>
              )}
            </div>

            {/* Completion Pie */}
            <div className="rounded-lg border p-4" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
              <h4 className="text-xs font-semibold mb-3" style={{ color: '#374151' }}>完成情况</h4>
              {summary.total > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={completionPieData} cx="50%" cy="50%" outerRadius={80} innerRadius={45} dataKey="value"
                      label={(props: PieLabelProps) => { PIE_LABEL_PLACED.length = 0; return renderAntiOverlapPieLabel(props); }}
                      labelLine={false}>
                      {completionPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[240px] text-xs" style={{ color: '#9CA3AF' }}>暂无数据</div>
              )}
            </div>
          </div>

          {/* ===== Project Level: Module Table + Charts ===== */}
          {level === 'project' && data.modules && (
            <>
              {/* Module Comparison Stacked Bar Chart */}
              {data.modules.length > 0 && (
                <div className="rounded-lg border p-4 mb-6" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
                  <h4 className="text-xs font-semibold mb-3" style={{ color: '#374151' }}>各特性测试执行情况</h4>
                  <ResponsiveContainer width="100%" height={Math.max(200, data.modules.length * 32)}>
                    <BarChart data={moduleBarData} layout="vertical" margin={{ left: 20, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} interval={0} />
                      <Tooltip content={((props: { active?: boolean; payload?: Array<{ payload: Record<string, unknown> }> }) => {
                        if (!props.active || !props.payload || props.payload.length === 0) return null;
                        const d = props.payload[0].payload as { name: string; 通过: number; 失败: number; 阻塞: number; 未完成: number; passCount: number; failCount: number; blockCount: number; incompleteCount: number };
                        return (
                          <div className="bg-white border rounded-lg shadow-lg px-3 py-2 text-xs" style={{ borderColor: '#E5E7EB' }}>
                            <p className="font-semibold mb-1" style={{ color: '#1F2937' }}>{d.name}</p>
                            <p style={{ color: '#22C55E' }}>通过 ({d.passCount}): {d.通过}%</p>
                            <p style={{ color: '#EF4444' }}>失败 ({d.failCount}): {d.失败}%</p>
                            <p style={{ color: '#F97316' }}>阻塞 ({d.blockCount}): {d.阻塞}%</p>
                            <p style={{ color: '#9CA3AF' }}>未完成 ({d.incompleteCount}): {d.未完成}%</p>
                          </div>
                        );
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      }) as any} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="通过" stackId="a" fill="#22C55E" barSize={16} />
                      <Bar dataKey="失败" stackId="a" fill="#EF4444" barSize={16} />
                      <Bar dataKey="阻塞" stackId="a" fill="#F97316" barSize={16} />
                      <Bar dataKey="未完成" stackId="a" fill="#9CA3AF" barSize={16} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Failed & Blocked Distribution Pie */}
              {(failedDistData.length > 0 || blockedDistData.length > 0) && (
                <div className="grid grid-cols-2 gap-4 mb-6">
                  {failedDistData.length > 0 && (
                    <div className="rounded-lg border p-4" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
                      <h4 className="text-xs font-semibold mb-3" style={{ color: '#374151' }}>失败用例分布</h4>
                      <ResponsiveContainer width="100%" height={240}>
                        <PieChart>
                          <Pie data={failedDistData} cx="50%" cy="50%" outerRadius={75} innerRadius={42} dataKey="value"
                            label={(props: PieLabelProps) => { PIE_LABEL_PLACED.length = 0; return renderAntiOverlapPieLabel(props); }}
                            labelLine={false}>
                            {failedDistData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {blockedDistData.length > 0 && (
                    <div className="rounded-lg border p-4" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
                      <h4 className="text-xs font-semibold mb-3" style={{ color: '#374151' }}>阻塞用例分布</h4>
                      <ResponsiveContainer width="100%" height={240}>
                        <PieChart>
                          <Pie data={blockedDistData} cx="50%" cy="50%" outerRadius={75} innerRadius={42} dataKey="value"
                            label={(props: PieLabelProps) => { PIE_LABEL_PLACED.length = 0; return renderAntiOverlapPieLabel(props); }}
                            labelLine={false}>
                            {blockedDistData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}

              {/* Module Table */}
              {data.modules.length > 0 && (
                <div className="rounded-lg border" style={{ borderColor: '#E5E7EB' }}>
                  <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
                    <h4 className="text-xs font-semibold" style={{ color: '#374151' }}>各特性明细</h4>
                    <div className="flex items-center gap-1">
                      <span className="text-xs" style={{ color: '#9CA3AF' }}>排序:</span>
                      {(['completionRate', 'passRate', 'failed', 'blocked'] as const).map(field => (
                        <button key={field} className="px-2 py-0.5 text-xs rounded border transition-colors"
                          style={{
                            borderColor: sortField === field ? '#0073E6' : '#E5E7EB',
                            color: sortField === field ? '#0073E6' : '#6B7280',
                            backgroundColor: sortField === field ? '#F0F7FF' : 'transparent',
                          }}
                          onClick={() => {
                            if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                            else { setSortField(field); setSortDir('desc'); }
                          }}
                        >
                          {field === 'completionRate' ? '完成率' : field === 'passRate' ? '通过率' : field === 'failed' ? '失败数' : '阻塞数'}
                          {sortField === field && (sortDir === 'desc' ? ' ↓' : ' ↑')}
                        </button>
                      ))}
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ backgroundColor: '#F9FAFB' }}>
                        <th className="text-left px-4 py-2 font-medium" style={{ color: '#6B7280' }}>特性名称</th>
                        <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>总数</th>
                        <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>完成率</th>
                        <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>通过率</th>
                        <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>失败</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>阻塞</th>
                        <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedModules.map(m => (
                        <tr key={m.id} className="border-t hover:bg-gray-50" style={{ borderColor: '#F3F4F6' }}>
                          <td className="px-4 py-2 font-medium" style={{ color: '#1F2937' }}>{m.name}</td>
                          <td className="text-center px-3 py-2" style={{ color: '#374151' }}>{m.total}</td>
                          <td className="text-center px-3 py-2">
                            <span className="inline-flex items-center gap-1">
                              <span style={{ color: m.completionRate >= 80 ? '#22C55E' : m.completionRate >= 50 ? '#F97316' : '#EF4444' }}>{m.completionRate}%</span>
                            </span>
                          </td>
                          <td className="text-center px-3 py-2">
                            <span style={{ color: m.passRate >= 80 ? '#22C55E' : m.passRate >= 50 ? '#F97316' : '#EF4444' }}>{m.passRate}%</span>
                          </td>
                          <td className="text-center px-3 py-2">
                            <span style={{ color: m.failed > 0 ? '#EF4444' : '#9CA3AF' }}>{m.failed}</span>
                          </td>
                          <td className="text-center px-3 py-2">
                            <span style={{ color: m.blocked > 0 ? '#F97316' : '#9CA3AF' }}>{m.blocked}</span>
                          </td>
                          <td className="text-center px-3 py-2">
                            <button className="text-xs px-2 py-0.5 rounded hover:bg-blue-50" style={{ color: '#0073E6' }}
                              onClick={() => onNavigateModule(m.id)}
                            >
                              查看详情
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* JIRA Links Section */}
              {level === 'project' && data.jiraLinks && data.jiraLinks.length > 0 && (
                <JiraLinksSection jiraLinks={data.jiraLinks} onNavigateCase={onNavigateCase} />
              )}
            </>
          )}

          {/* ===== Module Level: Case List + Chart ===== */}
          {level === 'module' && data.cases && (
            <>
              {/* Case Status Bar Chart */}
              {data.cases.length > 0 && (
                <div className="rounded-lg border p-4 mb-6" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
                  <h4 className="text-xs font-semibold mb-3" style={{ color: '#374151' }}>用例执行状态分布</h4>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={[
                      { name: 'Pass', count: summary.passed, fill: CHART_COLORS.passed },
                      { name: 'Fail', count: summary.failed, fill: CHART_COLORS.failed },
                      { name: 'Incomplete', count: summary.incomplete, fill: CHART_COLORS.incomplete },
                      { name: 'Block', count: summary.blocked, fill: CHART_COLORS.orange },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={40}>
                        {[
                          { name: 'Pass', count: summary.passed, fill: CHART_COLORS.passed },
                          { name: 'Fail', count: summary.failed, fill: CHART_COLORS.failed },
                          { name: 'Incomplete', count: summary.incomplete, fill: CHART_COLORS.incomplete },
                          { name: 'Block', count: summary.blocked, fill: CHART_COLORS.orange },
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Case List */}
              {data.cases.length > 0 && (
                <div className="rounded-lg border" style={{ borderColor: '#E5E7EB' }}>
                  <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
                    <h4 className="text-xs font-semibold" style={{ color: '#374151' }}>用例明细 ({filteredCases.length}/{data.cases.length})</h4>
                    <div className="flex items-center gap-1">
                      {(['all', 'failed', 'blocked', 'incomplete'] as const).map(filter => (
                        <button key={filter} className="px-2 py-0.5 text-xs rounded border transition-colors"
                          style={{
                            borderColor: caseFilter === filter ? '#0073E6' : '#E5E7EB',
                            color: caseFilter === filter ? '#0073E6' : '#6B7280',
                            backgroundColor: caseFilter === filter ? '#F0F7FF' : 'transparent',
                          }}
                          onClick={() => setCaseFilter(filter)}
                        >
                          {filter === 'all' ? '全部' : filter === 'failed' ? '失败' : filter === 'blocked' ? '阻塞' : '未完成'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-[300px] overflow-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ backgroundColor: '#F9FAFB' }}>
                          <th className="text-left px-4 py-2 font-medium" style={{ color: '#6B7280' }}>用例名称</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>优先级</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>测试结果</th>
                          <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCases.map(c => (
                          <tr key={c.id} className="border-t hover:bg-gray-50" style={{ borderColor: '#F3F4F6' }}>
                            <td className="px-4 py-2 font-medium truncate max-w-[300px]" style={{ color: '#1F2937' }}>{c.case_name}</td>
                            <td className="text-center px-3 py-2">
                              <span className="inline-block px-1.5 py-0.5 rounded text-xs"
                                style={{
                                  backgroundColor: c.priority === 'High' ? '#FEF2F2' : c.priority === 'Low' ? '#F0FFF4' : '#FFFBEB',
                                  color: c.priority === 'High' ? '#DC2626' : c.priority === 'Low' ? '#16A34A' : '#D97706',
                                }}
                              >
                                {c.priority}
                              </span>
                            </td>
                            <td className="text-center px-3 py-2">
                              <span className="inline-block px-1.5 py-0.5 rounded text-xs"
                                style={{
                                  backgroundColor: c.status === 'passed' ? '#F0FFF4' : c.status === 'failed' ? '#FEF2F2' : c.status === 'blocked' ? '#FFF7ED' : '#F3F4F6',
                                  color: c.status === 'passed' ? '#16A34A' : c.status === 'failed' ? '#DC2626' : c.status === 'blocked' ? '#EA580C' : '#6B7280',
                                }}
                              >
                                {c.status === 'passed' ? '通过' : c.status === 'failed' ? '失败' : c.status === 'blocked' ? '阻塞' : '未完成'}
                              </span>
                            </td>
                            <td className="text-center px-3 py-2">
                              <button className="text-xs px-2 py-0.5 rounded hover:bg-blue-50" style={{ color: '#0073E6' }}
                                onClick={() => onNavigateCase(c.id)}
                              >
                                查看
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {data.cases.length === 0 && (
                <div className="text-center py-8 text-xs" style={{ color: '#9CA3AF' }}>该特性下暂无用例</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function JiraLinksSection({ jiraLinks, onNavigateCase }: {
  jiraLinks: Array<{ link: string; cases: Array<{ id: number; case_name: string; test_result: string | null; module_name: string }> }>;
  onNavigateCase: (caseId: number) => void;
}) {
  const [expandedJira, setExpandedJira] = useState<string | null>(null);

  return (
    <div className="rounded-lg border mb-6" style={{ borderColor: '#E5E7EB' }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
        <h4 className="text-xs font-semibold" style={{ color: '#374151' }}>JIRA 单统计</h4>
        <span className="text-xs" style={{ color: '#9CA3AF' }}>共 {jiraLinks.length} 个 JIRA 单</span>
      </div>
      <div className="max-h-[300px] overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: '#F9FAFB' }}>
              <th className="text-left px-4 py-2 font-medium" style={{ color: '#6B7280' }}>JIRA 链接</th>
              <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>关联用例数</th>
              <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {jiraLinks.map((jira) => (
              <Fragment key={jira.link}>
                <tr className="border-t hover:bg-gray-50" style={{ borderColor: '#F3F4F6' }}>
                  <td className="px-4 py-2">
                    <a href={jira.link} target="_blank" rel="noopener noreferrer"
                      className="font-medium hover:underline" style={{ color: '#0073E6' }}
                    >
                      {jira.link.length > 60 ? jira.link.substring(0, 60) + '...' : jira.link}
                    </a>
                  </td>
                  <td className="text-center px-3 py-2">
                    <span className="inline-block px-1.5 py-0.5 rounded" style={{ backgroundColor: '#F0F7FF', color: '#0073E6' }}>
                      {jira.cases.length}
                    </span>
                  </td>
                  <td className="text-center px-3 py-2">
                    <button className="text-xs px-2 py-0.5 rounded hover:bg-blue-50" style={{ color: '#0073E6' }}
                      onClick={() => setExpandedJira(expandedJira === jira.link ? null : jira.link)}
                    >
                      {expandedJira === jira.link ? '收起' : '展开'}
                    </button>
                  </td>
                </tr>
                {expandedJira === jira.link && (
                  <tr>
                    <td colSpan={3} className="px-4 py-2" style={{ backgroundColor: '#F9FAFB' }}>
                      <div className="space-y-1.5">
                        {jira.cases.map((c, cIdx) => (
                          <div key={`jira-case-${c.id}-${cIdx}`} className="flex items-center gap-3 px-3 py-1.5 rounded border" style={{ borderColor: '#E5E7EB', backgroundColor: '#FFF' }}>
                            <span className="text-xs" style={{ color: '#6B7280' }}>{c.module_name}</span>
                            <span className="text-xs font-medium flex-1" style={{ color: '#1F2937' }}>{c.case_name}</span>
                            <span className="inline-block px-1.5 py-0.5 rounded text-xs"
                              style={{
                                backgroundColor: c.test_result === 'Pass' ? '#F0FFF4' : c.test_result === 'Fail' ? '#FEF2F2' : c.test_result === 'Block' ? '#FFF7ED' : '#F3F4F6',
                                color: c.test_result === 'Pass' ? '#16A34A' : c.test_result === 'Fail' ? '#DC2626' : c.test_result === 'Block' ? '#EA580C' : '#6B7280',
                              }}
                            >
                              {c.test_result === 'Pass' ? '通过' : c.test_result === 'Fail' ? '失败' : c.test_result === 'Block' ? '阻塞' : '未完成'}
                            </span>
                            <button className="text-xs px-1.5 py-0.5 rounded hover:bg-blue-50" style={{ color: '#0073E6' }}
                              onClick={() => onNavigateCase(c.id)}
                            >
                              查看
                            </button>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, subtext, color }: { label: string; value: number; subtext?: string; color: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFBFC' }}>
      <div className="text-xs mb-1" style={{ color: '#6B7280' }}>{label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      {subtext && <div className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>{subtext}</div>}
    </div>
  );
}

function GanttKanbanView({
  data,
  loading,
  isManager,
  onClose,
  onNavigateCase,
  onNavigateTreeNode,
  onRefresh,
}: {
  data: KanbanGanttData | null;
  loading: boolean;
  isManager: boolean;
  onClose: () => void;
  onNavigateCase: (caseId: number) => void;
  onNavigateTreeNode: (type: 'project' | 'module', dbId: number) => void;
  onRefresh: () => void;
}) {
  const defaultStartDate = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  })();
  const [startDate, setStartDate] = useState<string>(defaultStartDate);
  const [periodMonths, setPeriodMonths] = useState<3 | 6 | 9 | 12>(6);
  const [granularity, setGranularity] = useState<'week' | 'month'>('week');
  const [hoveredProject, setHoveredProject] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [editingDates, setEditingDates] = useState<{ id: number; name: string; startDate: string; endDate: string } | null>(null);
  const [savingDates, setSavingDates] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [sortByStartDate, setSortByStartDate] = useState(false);
  const [showOnlyIncompleteModules, setShowOnlyIncompleteModules] = useState(false);
  const [expandedModuleKey, setExpandedModuleKey] = useState<string | null>(null);
  const ganttContainerRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const projects = data?.projects || [];
  const summary = data?.summary || {
    projectCount: 0,
    total: 0,
    completed: 0,
    incomplete: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    completionRate: 0,
    passRate: 0,
    blockedRate: 0,
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats/kanban/preferences')
      .then(res => res.json())
      .then(result => {
        if (cancelled) return;
        const preferences = result?.preferences;
        if (preferences) {
          if (preferences.startDate) setStartDate(preferences.startDate);
          if ([3, 6, 9, 12].includes(preferences.periodMonths)) setPeriodMonths(preferences.periodMonths);
          if (preferences.granularity === 'week' || preferences.granularity === 'month') {
            setGranularity(preferences.granularity);
          } else if (preferences.granularity === 'day') {
            setGranularity('week');
          }
          if (typeof preferences.sortByStartDate === 'boolean') {
            setSortByStartDate(preferences.sortByStartDate);
          }
          if (typeof preferences.showOnlyIncompleteModules === 'boolean') {
            setShowOnlyIncompleteModules(preferences.showOnlyIncompleteModules);
          }
          if (typeof preferences.selectedProjectId === 'number') {
            setSelectedProjectId(preferences.selectedProjectId);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPreferencesLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const timer = window.setTimeout(() => {
      fetch('/api/stats/kanban/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          periodMonths,
          granularity,
          sortByStartDate,
          showOnlyIncompleteModules,
          selectedProjectId,
        }),
      }).catch(() => {});
    }, 300);

    return () => window.clearTimeout(timer);
  }, [startDate, periodMonths, granularity, sortByStartDate, showOnlyIncompleteModules, selectedProjectId, preferencesLoaded]);

  const viewStartDate = new Date(startDate);
  const viewEndDate = new Date(viewStartDate);
  viewEndDate.setMonth(viewEndDate.getMonth() + periodMonths);

  const totalDays = Math.ceil((viewEndDate.getTime() - viewStartDate.getTime()) / (1000 * 60 * 60 * 24));

  const getDateOffset = (dateStr: string | null) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const diff = (d.getTime() - viewStartDate.getTime()) / (1000 * 60 * 60 * 24);
    return diff;
  };

  const getTodayOffset = () => {
    return (today.getTime() - viewStartDate.getTime()) / (1000 * 60 * 60 * 24);
  };

  const formatHeaderDate = (date: Date, gran: 'week' | 'month') => {
    if (gran === 'week') {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    } else {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
  };

  const generateTimeHeaders = () => {
    const headers: { label: string; width: number; date: Date }[] = [];
    if (granularity === 'week') {
      let weekStart = new Date(viewStartDate);
      while (weekStart < viewEndDate) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        const actualEnd = weekEnd < viewEndDate ? weekEnd : viewEndDate;
        const daysInWeek = Math.ceil((actualEnd.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24));
        headers.push({ label: formatHeaderDate(weekStart, 'week'), width: daysInWeek, date: new Date(weekStart) });
        weekStart = weekEnd;
      }
    } else {
      let monthStart = new Date(viewStartDate.getFullYear(), viewStartDate.getMonth(), 1);
      if (monthStart < viewStartDate) monthStart = new Date(viewStartDate);
      while (monthStart < viewEndDate) {
        const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
        const actualEnd = monthEnd < viewEndDate ? monthEnd : viewEndDate;
        const daysInMonth = Math.ceil((actualEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24));
        headers.push({ label: formatHeaderDate(monthStart, 'month'), width: daysInMonth, date: new Date(monthStart) });
        monthStart = monthEnd;
      }
    }
    return headers;
  };

  const timeHeaders = generateTimeHeaders();
  const totalWidthUnits = timeHeaders.reduce((sum, h) => sum + h.width, 0);
  const PX_PER_DAY = granularity === 'week' ? 12 : 6;
  const totalWidth = totalWidthUnits * PX_PER_DAY;
  const todayOffset = getTodayOffset();

  const parseDateOrMax = (dateStr: string | null) => {
    if (!dateStr) return Number.MAX_SAFE_INTEGER;
    const value = new Date(dateStr).getTime();
    return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
  };

  const orderedProjects = [...projects].sort((a, b) => {
    if (!sortByStartDate) return 0;
    const startDiff = parseDateOrMax(a.startDate) - parseDateOrMax(b.startDate);
    if (startDiff !== 0) return startDiff;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  useEffect(() => {
    if (orderedProjects.length === 0) {
      setSelectedProjectId(null);
      return;
    }
    if (!selectedProjectId || !orderedProjects.some(project => project.id === selectedProjectId)) {
      setSelectedProjectId(orderedProjects[0].id);
    }
  }, [orderedProjects, selectedProjectId]);

  const selectedProject = orderedProjects.find(project => project.id === selectedProjectId) || null;

  const getModuleTooltipText = (tester: KanbanTesterStat, moduleStat: KanbanModuleStat) => (
    `${tester.username} / ${moduleStat.moduleName}
完成 ${moduleStat.completed}/${moduleStat.total}
通过 ${moduleStat.passed}  失败 ${moduleStat.failed}  阻塞 ${moduleStat.blocked}  未完成 ${moduleStat.incomplete}`
  );

  const getVisibleModules = (tester: KanbanTesterStat) => {
    const modules = showOnlyIncompleteModules
      ? tester.modules.filter(moduleStat => moduleStat.incomplete > 0)
      : tester.modules;
    return modules;
  };

  const getCompletionColor = (rate: number) => {
    if (rate >= 100) return '#16A34A';
    if (rate >= 70) return '#0EA5E9';
    if (rate > 0) return '#F59E0B';
    return '#CBD5E1';
  };

  const getCaseStatusMeta = (testResult: string | null) => {
    if (testResult === 'Pass') return { label: '通过', color: '#16A34A', backgroundColor: '#DCFCE7' };
    if (testResult === 'Fail') return { label: '失败', color: '#DC2626', backgroundColor: '#FEE2E2' };
    if (testResult === 'Block') return { label: '阻塞', color: '#D97706', backgroundColor: '#FEF3C7' };
    return { label: '未完成', color: '#64748B', backgroundColor: '#F1F5F9' };
  };

  const getModuleCases = (tester: KanbanTesterStat, moduleStat: KanbanModuleStat): KanbanCaseStat[] => {
    if (!selectedProject) return [];
    return selectedProject.cases
      .filter(caseItem => caseItem.testerId === tester.userId && caseItem.moduleId === moduleStat.moduleId)
      .sort((a, b) => {
        const left = `${a.caseNo || ''} ${a.caseName || ''}`;
        const right = `${b.caseNo || ''} ${b.caseName || ''}`;
        return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' });
      });
  };

  const refreshBoardView = () => {
    const startTimes = projects
      .map(project => project.startDate ? new Date(project.startDate).getTime() : NaN)
      .filter(value => !Number.isNaN(value));
    const baseTime = startTimes.length > 0 ? Math.min(...startTimes) : Date.now();
    const anchorDate = new Date(baseTime);
    anchorDate.setDate(anchorDate.getDate() - 7);
    const normalized = `${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, '0')}-${String(anchorDate.getDate()).padStart(2, '0')}`;
    setStartDate(normalized);
    setPeriodMonths(9);
    setGranularity('month');
    setSortByStartDate(true);
    fetch('/api/stats/kanban/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: normalized,
        periodMonths: 9,
        granularity: 'month',
        sortByStartDate: true,
        showOnlyIncompleteModules,
        selectedProjectId,
      }),
    }).catch(() => {});
    onRefresh();
  };

  const handleSaveDates = async () => {
    if (!editingDates) return;
    setSavingDates(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingDates.id,
          start_date: editingDates.startDate || null,
          end_date: editingDates.endDate || null,
        }),
      });
      const d = await res.json();
      if (d.success) {
        setEditingDates(null);
        onRefresh();
      } else {
        alert(d.error || '保存失败');
      }
    } catch {
      alert('保存失败');
    } finally {
      setSavingDates(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: '#999' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderColor: '#0073E6' }}></div>
          <p className="text-sm">加载看板数据...</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: '#EEEEEE', backgroundColor: '#FAFBFC' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded" style={{ backgroundColor: '#0073E6' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
          </div>
          <span className="font-bold text-sm" style={{ color: '#1F2937' }}>项目看板</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F0F7FF', color: '#0073E6' }}>
            {summary.projectCount} 个进行中项目
          </span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded hover:bg-gray-100 transition-colors flex items-center gap-1"
          style={{ color: '#666' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          关闭看板
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 px-6 py-2 border-b" style={{ borderColor: '#EEEEEE', backgroundColor: '#FAFBFC' }}>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium" style={{ color: '#374151' }}>起始日期</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-xs px-2 py-1 border rounded"
            style={{ borderColor: '#D1D5DB', color: '#374151' }}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium" style={{ color: '#374151' }}>展示周期</label>
          <div className="flex items-center rounded border overflow-hidden" style={{ borderColor: '#D1D5DB' }}>
            {[3, 6, 9, 12].map(m => (
              <button
                key={m}
                onClick={() => setPeriodMonths(m as 3 | 6 | 9 | 12)}
                className="text-xs px-2.5 py-1 transition-colors"
                style={{
                  backgroundColor: periodMonths === m ? '#0073E6' : '#FFF',
                  color: periodMonths === m ? '#FFF' : '#374151',
                }}
              >
                {m}个月
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium" style={{ color: '#374151' }}>时间粒度</label>
          <div className="flex items-center rounded border overflow-hidden" style={{ borderColor: '#D1D5DB' }}>
            {[
              { key: 'week', label: '周' },
              { key: 'month', label: '月' },
            ].map(g => (
              <button
                key={g.key}
                onClick={() => setGranularity(g.key as 'week' | 'month')}
                className="text-xs px-2.5 py-1 transition-colors"
                style={{
                  backgroundColor: granularity === g.key ? '#0073E6' : '#FFF',
                  color: granularity === g.key ? '#FFF' : '#374151',
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={refreshBoardView}
          className="text-xs px-2.5 py-1 rounded border hover:bg-gray-50"
          style={{ borderColor: '#D1D5DB', color: '#374151' }}
        >
          刷新视图
        </button>
        <span className="text-xs" style={{ color: preferencesLoaded ? '#6B7280' : '#9CA3AF' }}>
          {preferencesLoaded ? '已按登录用户记住你的看板偏好' : '正在读取你的看板偏好...'}
        </span>
      </div>

      {/* Gantt Chart */}
      <div className="flex-1 overflow-auto px-6 py-4" ref={ganttContainerRef}>
        <div style={{ minWidth: totalWidth + 260 }}>
          {/* Time Header Row */}
          <div className="flex" style={{ borderBottom: '1px solid #E5E7EB' }}>
            <div className="flex-shrink-0" style={{ width: '260px' }}>
              <div className="text-sm font-semibold px-4 py-3" style={{ color: '#374151', backgroundColor: '#F9FAFB' }}>项目名称</div>
            </div>
            <div className="flex-1 flex" style={{ position: 'relative' }}>
              {timeHeaders.map((h, i) => (
                <div
                  key={i}
                  className="text-center text-xs px-1 py-2 border-l flex-shrink-0"
                  style={{
                    width: `${h.width * PX_PER_DAY}px`,
                    borderColor: '#E5E7EB',
                    color: '#6B7280',
                    backgroundColor: '#F9FAFB',
                    fontSize: '10px',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h.label}
                </div>
              ))}
            </div>
          </div>

          {/* Project Rows */}
          {orderedProjects.map(project => {
            const startOffset = getDateOffset(project.startDate);
            const endOffset = getDateOffset(project.endDate);
            const visibleStartOffset = startOffset === null ? null : Math.max(startOffset, 0);
            const visibleEndOffset = endOffset === null ? null : Math.min(endOffset, totalDays);
            const hasVisibleBar = visibleStartOffset !== null
              && visibleEndOffset !== null
              && visibleEndOffset > visibleStartOffset
              && endOffset !== null
              && startOffset !== null
              && endOffset > 0
              && startOffset < totalDays;
            const barLeft = hasVisibleBar ? visibleStartOffset * PX_PER_DAY : 0;
            const barWidth = hasVisibleBar ? (visibleEndOffset - visibleStartOffset) * PX_PER_DAY : 0;
            const testerNames = project.testers.map(tester => tester.username).join('、') || '暂无执行者';

            return (
              <div
                key={project.id}
                className="flex items-stretch"
                style={{
                  borderBottom: '1px solid #F3F4F6',
                  minHeight: '68px',
                  backgroundColor: selectedProjectId === project.id ? '#F8FBFF' : '#FFFFFF',
                }}
              >
                {/* Project Name */}
                <div className="flex-shrink-0 flex items-center gap-2 px-4" style={{ width: '260px' }}>
                  <button
                    onClick={() => setSelectedProjectId(project.id)}
                    className="text-left min-w-0"
                    style={{ width: '100%' }}
                  >
                    <div className="text-sm font-semibold truncate" style={{ color: '#1F2937' }}>{project.name}</div>
                    <div className="text-[11px] mt-1 leading-5" style={{ color: '#6B7280' }}>
                      {testerNames}
                    </div>
                  </button>
                  {isManager && (
                    <button
                      onClick={() => setEditingDates({
                        id: project.id,
                        name: project.name,
                        startDate: project.startDate || '',
                        endDate: project.endDate || '',
                      })}
                      className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100"
                      title="编辑日期"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                  )}
                </div>

                {/* Gantt Bar Area */}
                <div
                  className="flex-1 relative"
                  style={{ position: 'relative' }}
                  onMouseEnter={(e) => {
                    setHoveredProject(project.id);
                    setTooltipPos({ x: e.clientX + 12, y: e.clientY + 12 });
                  }}
                  onMouseLeave={() => {
                    setHoveredProject(null);
                    setTooltipPos(null);
                  }}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  {/* Grid lines */}
                  {timeHeaders.map((h, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-l"
                      style={{
                        left: `${h.width * PX_PER_DAY * timeHeaders.slice(0, i).reduce((s, hh) => s + hh.width, 0) / totalWidthUnits * 100}%`,
                        borderColor: '#F3F4F6',
                      }}
                    />
                  ))}

                  {/* Today Line */}
                  {todayOffset >= 0 && todayOffset <= totalDays && (
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        left: `${(todayOffset / totalWidthUnits) * 100}%`,
                        width: '2px',
                        backgroundColor: '#EF4444',
                        zIndex: 5,
                      }}
                    />
                  )}

                  {/* Project Bar */}
                  {hasVisibleBar && (
                    <div
                      className="absolute rounded"
                      style={{
                        left: `${(barLeft / totalWidth) * 100}%`,
                        width: `${(barWidth / totalWidth) * 100}%`,
                        top: '14px',
                        height: '34px',
                        backgroundColor: '#E6F2FF',
                        border: '1px solid #0073E6',
                        zIndex: 3,
                        cursor: 'pointer',
                      }}
                    >
                      {/* Completed portion */}
                      <div
                        className="h-full rounded-l"
                        style={{
                          width: `${project.completionRate}%`,
                          backgroundColor: getCompletionColor(project.completionRate),
                          borderRadius: project.completionRate >= 100 ? '3px' : '3px 0 0 3px',
                        }}
                      />
                      {/* Progress text */}
                      <span
                        className="absolute inset-0 flex items-center justify-center text-xs font-medium"
                        style={{ color: project.completionRate > 50 ? '#FFF' : '#0F766E', zIndex: 4 }}
                      >
                        {project.completionRate}%
                      </span>
                    </div>
                  )}

                  {/* No date set indicator */}
                  {barWidth <= 0 && (
                    <div className="absolute inset-0 flex items-center">
                      <span className="text-xs" style={{ color: '#D1D5DB', paddingLeft: '8px' }}>
                        {project.startDate && project.endDate ? '当前时间窗未覆盖该项目' : '未设置日期'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {orderedProjects.length === 0 && (
            <div className="text-center py-12 text-sm" style={{ color: '#9CA3AF' }}>
              暂无进行中的项目
            </div>
          )}
        </div>

        {selectedProject && (
          <div className="mt-5 rounded-md border overflow-hidden" style={{ borderColor: '#DDE3EA', backgroundColor: '#FFFFFF' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: '#E5E7EB', backgroundColor: '#F8FAFC' }}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold" style={{ color: '#1F2937' }}>{selectedProject.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#EEF6FF', color: '#0369A1' }}>
                      {selectedProject.testers.length} 位执行者
                    </span>
                    <button
                      onClick={() => onNavigateTreeNode('project', selectedProject.id)}
                      className="text-xs px-2 py-0.5 rounded border hover:bg-white"
                      style={{ borderColor: '#CBD5E1', color: '#475569' }}
                    >
                      定位项目
                    </button>
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#6B7280' }}>
                    {selectedProject.startDate && selectedProject.endDate
                      ? `${selectedProject.startDate} ~ ${selectedProject.endDate}`
                      : '项目日期尚未设置'}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {selectedProject.testers.map(tester => (
                      <span
                        key={tester.userId}
                        className="text-xs px-2 py-1 rounded-full"
                        style={{ backgroundColor: '#F3F4F6', color: '#374151' }}
                      >
                        {tester.username}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: '#ECFDF5', color: '#047857' }}>
                    完成 {selectedProject.completed}/{selectedProject.total}
                  </span>
                  <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
                    失败 {selectedProject.failed}
                  </span>
                  <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: '#FFF7ED', color: '#EA580C' }}>
                    阻塞 {selectedProject.blocked}
                  </span>
                  <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: '#F3F4F6', color: '#6B7280' }}>
                    未完成 {selectedProject.incomplete}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-5 py-4" style={{ borderColor: '#E5E7EB' }}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold" style={{ color: '#1F2937' }}>执行者与二级目录进度</h4>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowOnlyIncompleteModules(value => !value)}
                    className="text-xs px-3 py-1.5 rounded border hover:bg-gray-50"
                    style={{ borderColor: '#D1D5DB', color: '#374151' }}
                  >
                    {showOnlyIncompleteModules ? '查看全部目录' : '一键查看未完成目录'}
                  </button>
                </div>
              </div>
              <div className="space-y-4">
                {selectedProject.testers.map(tester => (
                  <div key={tester.userId} className="rounded-md border" style={{ borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' }}>
                    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr]">
                      <div className="p-4 border-b lg:border-b-0 lg:border-r" style={{ borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' }}>
                        <div className="flex items-start justify-between gap-3 lg:block">
                          <div>
                            <div className="text-sm font-semibold" style={{ color: '#0F172A' }}>{tester.username}</div>
                            <div className="text-xs mt-1 leading-5" style={{ color: '#64748B' }}>
                              完成 {tester.completed}/{tester.total}
                            </div>
                            <div className="text-[11px] leading-5" style={{ color: '#94A3B8' }}>
                              失败 {tester.failed} · 阻塞 {tester.blocked} · 未完成 {tester.incomplete}
                            </div>
                          </div>
                          <div className="text-right lg:text-left lg:mt-4">
                            <div className="text-2xl font-bold leading-none" style={{ color: getCompletionColor(tester.completionRate) }}>
                              {tester.completionRate}%
                            </div>
                            <div className="text-[11px] mt-1" style={{ color: '#64748B' }}>总进度</div>
                          </div>
                        </div>
                        <div className="h-4 rounded-sm overflow-hidden mt-4" style={{ backgroundColor: '#E2E8F0' }}>
                          <div
                            className="h-full rounded-sm"
                            style={{
                              width: `${tester.completionRate}%`,
                              backgroundColor: getCompletionColor(tester.completionRate),
                            }}
                          />
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                          {getVisibleModules(tester).length > 0 ? getVisibleModules(tester).map(moduleStat => {
                            const moduleRowKey = `${tester.userId}-${moduleStat.key}`;
                            const isModuleExpanded = expandedModuleKey === moduleRowKey;
                            const moduleCases = getModuleCases(tester, moduleStat);

                            return (
                              <div key={moduleRowKey} className="rounded-md border px-3 py-2" style={{ borderColor: isModuleExpanded ? '#93C5FD' : '#E2E8F0', backgroundColor: isModuleExpanded ? '#F8FBFF' : '#FFFFFF' }}>
                                <div className="flex items-start justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedModuleKey(isModuleExpanded ? null : moduleRowKey)}
                                    className="min-w-0 text-left flex-1"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px]" style={{ color: '#64748B' }}>{isModuleExpanded ? '▼' : '▶'}</span>
                                      <span className="text-xs font-semibold truncate" style={{ color: '#0F172A' }}>{moduleStat.moduleName}</span>
                                    </div>
                                    <div className="text-[11px] mt-1" style={{ color: '#64748B' }}>
                                      完成 {moduleStat.completed}/{moduleStat.total} · 未完成 {moduleStat.incomplete}
                                    </div>
                                  </button>
                                  <div className="flex flex-shrink-0 items-center gap-1">
                                    <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#F1F5F9', color: '#334155' }}>
                                      {moduleStat.completionRate}%
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => onNavigateTreeNode('module', moduleStat.moduleId)}
                                      className="text-xs px-2 py-0.5 rounded border hover:bg-slate-50"
                                      style={{ borderColor: '#CBD5E1', color: '#475569' }}
                                    >
                                      定位
                                    </button>
                                  </div>
                                </div>
                                <div
                                  className="h-2 rounded-sm overflow-hidden mt-2"
                                  style={{ backgroundColor: '#E2E8F0' }}
                                  title={getModuleTooltipText(tester, moduleStat)}
                                >
                                  <div
                                    className="h-full rounded-sm"
                                    style={{
                                      width: `${moduleStat.completionRate}%`,
                                      backgroundColor: getCompletionColor(moduleStat.completionRate),
                                    }}
                                  />
                                </div>
                                {isModuleExpanded && (
                                  <div className="mt-3 border-t pt-2 space-y-1.5" style={{ borderColor: '#E2E8F0' }}>
                                    {moduleCases.length > 0 ? moduleCases.map(caseItem => {
                                      const statusMeta = getCaseStatusMeta(caseItem.testResult);
                                      const caseTitle = [caseItem.caseNo, caseItem.caseName].filter(Boolean).join(' ') || '未命名用例';

                                      return (
                                        <div key={caseItem.id} className="flex items-center gap-2 rounded px-2 py-1.5" style={{ backgroundColor: '#FFFFFF' }}>
                                          <span className="text-[11px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ color: statusMeta.color, backgroundColor: statusMeta.backgroundColor }}>
                                            {statusMeta.label}
                                          </span>
                                          <span className="text-xs truncate flex-1" style={{ color: '#334155' }} title={caseTitle}>
                                            {caseTitle}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => onNavigateCase(caseItem.id)}
                                            className="text-xs px-2 py-0.5 rounded border flex-shrink-0 hover:bg-slate-50"
                                            style={{ borderColor: '#CBD5E1', color: '#2563EB' }}
                                          >
                                            详情
                                          </button>
                                        </div>
                                      );
                                    }) : (
                                      <div className="text-xs px-2 py-2" style={{ color: '#94A3B8' }}>暂无用例</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          }) : (
                            <div className="text-xs" style={{ color: '#9CA3AF' }}>
                              {showOnlyIncompleteModules ? '该执行者当前没有未完成目录' : '该执行者暂无用例'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {selectedProject.testers.length === 0 && (
                  <div className="rounded-md border px-4 py-6 text-sm text-center" style={{ borderColor: '#E2E8F0', color: '#94A3B8' }}>
                    暂无执行者
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hover Tooltip */}
      {hoveredProject !== null && tooltipPos && data && (() => {
        const project = data.projects.find(p => p.id === hoveredProject);
        if (!project) return null;
        return createPortal(
          <div
            className="fixed z-[100] bg-white rounded-lg shadow-xl border p-4"
            style={{
              left: `${Math.min(tooltipPos.x, window.innerWidth - 420)}px`,
              top: `${Math.min(tooltipPos.y, window.innerHeight - 360)}px`,
              minWidth: '320px',
              maxWidth: '420px',
              borderColor: '#E5E7EB',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold" style={{ color: '#1F2937' }}>{project.name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{
                backgroundColor: '#F1F5F9',
                color: getCompletionColor(project.completionRate),
              }}>
                {project.completionRate}%
              </span>
            </div>
            {project.startDate && project.endDate && (
              <div className="text-xs mb-2" style={{ color: '#6B7280' }}>
                {project.startDate} ~ {project.endDate}
              </div>
            )}
            {project.testers.length > 0 && (
              <div>
                <div className="text-xs font-semibold mb-1.5" style={{ color: '#374151' }}>执行者总体进度</div>
                <div className="space-y-1.5">
                  {project.testers.map(tester => (
                    <div key={tester.userId} className="rounded border px-2 py-2" style={{ borderColor: '#F3F4F6' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs flex-shrink-0" style={{ color: '#374151', width: '56px' }}>{tester.username}</span>
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${tester.completionRate}%`,
                              backgroundColor: getCompletionColor(tester.completionRate),
                            }}
                          />
                        </div>
                        <span className="text-xs flex-shrink-0" style={{ color: '#6B7280', width: '36px', textAlign: 'right' }}>{tester.completionRate}%</span>
                      </div>
                      <div className="mt-1.5 text-[11px]" style={{ color: '#6B7280' }}>
                        完成 {tester.completed}/{tester.total} · 失败 {tester.failed} · 阻塞 {tester.blocked}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>,
          document.body
        );
      })()}

      {/* Date Edit Dialog */}
      {editingDates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-xl shadow-2xl w-[400px] overflow-hidden">
            <div className="px-6 py-4 border-b" style={{ borderColor: '#EEEEEE' }}>
              <h3 className="text-base font-bold" style={{ color: '#1F2937' }}>编辑项目日期</h3>
              <p className="text-sm mt-1" style={{ color: '#6B7280' }}>{editingDates.name}</p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>开始日期</label>
                <input
                  type="date"
                  value={editingDates.startDate}
                  onChange={(e) => setEditingDates({ ...editingDates, startDate: e.target.value })}
                  className="w-full text-sm px-3 py-2 border rounded"
                  style={{ borderColor: '#D1D5DB', color: '#374151' }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>结束日期</label>
                <input
                  type="date"
                  value={editingDates.endDate}
                  onChange={(e) => setEditingDates({ ...editingDates, endDate: e.target.value })}
                  className="w-full text-sm px-3 py-2 border rounded"
                  style={{ borderColor: '#D1D5DB', color: '#374151' }}
                />
              </div>
            </div>
            <div className="px-6 py-3 border-t flex justify-end gap-2" style={{ borderColor: '#EEEEEE' }}>
              <button
                onClick={() => setEditingDates(null)}
                className="px-4 py-2 text-sm rounded border hover:bg-gray-50"
                style={{ borderColor: '#D1D5DB', color: '#374151' }}
              >
                取消
              </button>
              <button
                onClick={handleSaveDates}
                disabled={savingDates}
                className="px-4 py-2 text-sm rounded text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#0073E6' }}
              >
                {savingDates ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Bug Management Panel ============
function BugManagementPanel({
  show,
  onToggle,
  canManage,
}: {
  show: boolean;
  onToggle: () => void;
  canManage: boolean;
}) {
  const [bugs, setBugs] = useState<Array<{
    id: number;
    title: string;
    description: string;
    reporter_name: string;
    status: string;
    resolver_name: string | null;
    resolve_note: string;
    resolved_at: string | null;
    created_at: string;
  }>>([]);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [resolveNote, setResolveNote] = useState('');
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadBugs = useCallback(async () => {
    try {
      const res = await fetch('/api/bugs');
      const data = await res.json();
      if (data.bugs) setBugs(data.bugs);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (show) loadBugs();
  }, [show, loadBugs]);

  const handleResolve = async (bugId: number) => {
    if (!canManage) return;
    try {
      const res = await fetch('/api/bugs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bugId, status: 'resolved', resolveNote }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '已标记为解决' });
        setResolvingId(null);
        setResolveNote('');
        loadBugs();
      } else {
        setMessage({ type: 'error', text: data.error || '操作失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    }
    setTimeout(() => setMessage(null), 1000);
  };

  const handleReopen = async (bugId: number) => {
    if (!canManage) return;
    try {
      const res = await fetch('/api/bugs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bugId, status: 'open' }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '已重新打开' });
        loadBugs();
      }
    } catch { /* ignore */ }
    setTimeout(() => setMessage(null), 1000);
  };

  const handleDelete = async (bugId: number) => {
    if (!canManage) return;
    if (!confirm('确定要删除此问题单吗？')) return;
    try {
      const res = await fetch(`/api/bugs?id=${bugId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '已删除' });
        loadBugs();
      }
    } catch { /* ignore */ }
    setTimeout(() => setMessage(null), 1000);
  };

  if (!show) return null;

  const visibleBugs = bugs.filter(b => filter === 'all' || b.status === filter);
  const counts = {
    open: bugs.filter(b => b.status === 'open').length,
    resolved: bugs.filter(b => b.status === 'resolved').length,
    all: bugs.length,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[80vh] overflow-hidden" style={{ animation: 'fadeIn 0.2s ease' }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#EEEEEE' }}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#FEF2F2' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold" style={{ color: '#1F2937' }}>{canManage ? '问题单管理' : '问题单看板'}</h3>
              <p className="text-xs" style={{ color: '#9CA3AF' }}>
                {canManage ? '处理用户提交的BUG和需求' : '查看当前问题单处理进展'}
              </p>
            </div>
          </div>
          <button onClick={onToggle} className="p-1 rounded hover:bg-gray-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="px-6 py-3 border-b flex items-center gap-2" style={{ borderColor: '#EEEEEE' }}>
          {(['open', 'all', 'resolved'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1 text-xs rounded-full transition-colors"
              style={{
                backgroundColor: filter === f ? (f === 'open' ? '#FEF2F2' : f === 'resolved' ? '#F0FFF4' : '#F3F4F6') : 'transparent',
                color: filter === f ? (f === 'open' ? '#DC2626' : f === 'resolved' ? '#16A34A' : '#374151') : '#6B7280',
                border: `1px solid ${filter === f ? (f === 'open' ? '#FECACA' : f === 'resolved' ? '#BBF7D0' : '#D1D5DB') : '#E5E7EB'}`,
              }}
            >
              {f === 'open' ? '待处理' : f === 'resolved' ? '已解决' : '全部'} ({counts[f]})
            </button>
          ))}
        </div>

        <div className="px-6 py-3 overflow-auto" style={{ maxHeight: '55vh' }}>
          {message && (
            <div className="mb-3 px-3 py-2 rounded-md text-sm" style={{
              backgroundColor: message.type === 'success' ? '#F0FFF4' : '#FFF5F5',
              color: message.type === 'success' ? '#16A34A' : '#DC2626',
            }}>
              {message.text}
            </div>
          )}
          {visibleBugs.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: '#9CA3AF' }}>
              {filter === 'open' ? '暂无待处理的问题' : filter === 'resolved' ? '暂无已解决的问题' : '暂无问题单'}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleBugs.map(bug => (
                <div key={bug.id} className="border rounded-lg p-3 hover:shadow-sm transition-shadow" style={{ borderColor: bug.status === 'resolved' ? '#D1FAE5' : '#FECACA' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="inline-block px-1.5 py-0.5 text-xs rounded"
                          style={{
                            backgroundColor: bug.status === 'resolved' ? '#F0FFF4' : '#FEF2F2',
                            color: bug.status === 'resolved' ? '#16A34A' : '#DC2626',
                          }}
                        >
                          {bug.status === 'resolved' ? '已解决' : '待处理'}
                        </span>
                        <span className="text-xs" style={{ color: '#9CA3AF' }}>#{bug.id}</span>
                      </div>
                      <p className="text-sm font-medium truncate" style={{ color: '#1F2937' }}>{bug.title}</p>
                      {bug.description && (
                        <p className="text-xs mt-1 line-clamp-2" style={{ color: '#6B7280' }}>{bug.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: '#9CA3AF' }}>
                        <span>提交者: {bug.reporter_name}</span>
                        <span>{bug.created_at}</span>
                        {bug.status === 'resolved' && bug.resolver_name && (
                          <span style={{ color: '#16A34A' }}>处理人: {bug.resolver_name} ({bug.resolved_at})</span>
                        )}
                      </div>
                      {bug.resolve_note && (
                        <div className="mt-1.5 px-2 py-1 rounded text-xs" style={{ backgroundColor: '#F0FFF4', color: '#16A34A', border: '1px solid #D1FAE5' }}>
                          备注: {bug.resolve_note}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {canManage && bug.status === 'open' && (
                        resolvingId === bug.id ? (
                          <div className="flex flex-col gap-1" style={{ minWidth: '200px' }}>
                            <input
                              autoFocus
                              type="text"
                              value={resolveNote}
                              onChange={(e) => setResolveNote(e.target.value)}
                              placeholder="备注（可选）"
                              className="px-2 py-1 text-xs border rounded"
                              style={{ borderColor: '#D1D5DB' }}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleResolve(bug.id); if (e.key === 'Escape') { setResolvingId(null); setResolveNote(''); } }}
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleResolve(bug.id)}
                                className="px-2 py-0.5 text-xs rounded text-white"
                                style={{ backgroundColor: '#16A34A' }}
                              >
                                确认解决
                              </button>
                              <button
                                onClick={() => { setResolvingId(null); setResolveNote(''); }}
                                className="px-2 py-0.5 text-xs rounded border"
                                style={{ borderColor: '#D1D5DB', color: '#6B7280' }}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setResolvingId(bug.id)}
                            className="px-2 py-1 text-xs rounded hover:bg-green-50 transition-colors"
                            style={{ color: '#16A34A', border: '1px solid #BBF7D0' }}
                          >
                            标记解决
                          </button>
                        )
                      )}
                      {canManage && bug.status === 'resolved' && (
                        <button
                          onClick={() => handleReopen(bug.id)}
                          className="px-2 py-1 text-xs rounded hover:bg-yellow-50 transition-colors"
                          style={{ color: '#D97706', border: '1px solid #FDE68A' }}
                        >
                          重新打开
                        </button>
                      )}
                      {canManage && (
                        <button
                          onClick={() => handleDelete(bug.id)}
                          className="p-1 rounded hover:bg-red-50 transition-colors"
                          title="删除"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
