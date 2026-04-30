import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const db = getDb();

    const { searchParams } = new URL(request.url);
    const testerFilter = searchParams.get('testerId'); // filter by assigned tester

    // Build a set of case IDs assigned to the tester if filtering
    let filteredCaseIds: Set<number> | null = null;

    if (testerFilter) {
      const tid = Number(testerFilter);
      // Get all case IDs whose resolved tester matches tid
      // Resolution: case-level > module-level > project-level
      const cases = db.prepare(`
        SELECT c.id,
          COALESCE(ca.user_id, ma.user_id, pa.user_id) as resolved_tester_id
        FROM cases c
        JOIN modules m ON c.module_id = m.id
        JOIN projects p ON m.project_id = p.id
        LEFT JOIN assignments ca ON ca.level = 'case' AND ca.target_id = c.id
        LEFT JOIN assignments ma ON ma.level = 'module' AND ma.target_id = c.module_id
        LEFT JOIN assignments pa ON pa.level = 'project' AND pa.target_id = p.id
      `).all() as { id: number; resolved_tester_id: number | null }[];

      filteredCaseIds = new Set(
        cases.filter(c => c.resolved_tester_id === tid).map(c => c.id)
      );
    }

    // Get all assignments for tree display (tester badges)
    const assignments = db.prepare(`
      SELECT a.level, a.target_id, a.user_id, u.username as tester_name
      FROM assignments a
      JOIN users u ON a.user_id = u.id
    `).all() as { level: string; target_id: number; user_id: number; tester_name: string }[];

    // Build a lookup: "level-targetId" -> tester info
    const assignmentMap = new Map<string, { userId: number; testerName: string }>();
    for (const a of assignments) {
      assignmentMap.set(`${a.level}-${a.target_id}`, { userId: a.user_id, testerName: a.tester_name });
    }

    // Get all projects (all are public now)
    const projects = db.prepare('SELECT * FROM projects ORDER BY sort_order, id').all() as {
      id: number;
      name: string;
      sort_order: number;
      is_public: number;
      user_id: number;
    }[];

    const tree: TreeNode[] = [];

    for (const project of projects) {
      const projectTester = assignmentMap.get(`project-${project.id}`);

      // Get modules for this project
      const modules = db.prepare('SELECT * FROM modules WHERE project_id = ? ORDER BY sort_order, id').all(project.id) as {
        id: number;
        name: string;
        sort_order: number;
      }[];

      const moduleNodes: TreeNode[] = [];

      for (const mod of modules) {
        const moduleTester = assignmentMap.get(`module-${mod.id}`);

        // Get cases for this module
        const cases = db.prepare('SELECT * FROM cases WHERE module_id = ? ORDER BY sort_order, id').all(mod.id) as {
          id: number;
          case_name: string;
          case_no: string;
          test_result: string | null;
          sort_order: number;
        }[];

        const caseNodes: TreeNode[] = [];

        for (const c of cases) {
          // Skip cases not assigned to the filtered tester
          if (filteredCaseIds && !filteredCaseIds.has(c.id)) continue;

          const caseTester = assignmentMap.get(`case-${c.id}`);
          // Resolved tester: case > module > project
          const resolvedTester = caseTester || moduleTester || projectTester;

          // Tree display: "编号 + 用例名称" if both exist, else whichever exists
          const trimmedNo = c.case_no?.trim() || '';
          const trimmedName = c.case_name?.trim() || '';
          const displayName = trimmedNo && trimmedName
            ? `${trimmedNo} ${trimmedName}`
            : trimmedNo || trimmedName || '新用例';

          caseNodes.push({
            id: `case-${c.id}`,
            type: 'case',
            dbId: c.id,
            name: displayName,
            caseNo: c.case_no?.trim() || '',
            testResult: c.test_result,
            moduleId: mod.id,
            projectId: project.id,
            testerId: resolvedTester?.userId,
            testerName: resolvedTester?.testerName,
          });
        }

        // Skip module if it has no cases after filtering
        if (filteredCaseIds && caseNodes.length === 0) continue;

        // Aggregate resolved tester names from child cases for module display
        const moduleTesterNames = [...new Set(
          caseNodes.map(c => c.testerName).filter(Boolean)
        )];

        moduleNodes.push({
          id: `module-${mod.id}`,
          type: 'module',
          dbId: mod.id,
          name: mod.name,
          projectId: project.id,
          children: caseNodes,
          testerId: moduleTester?.userId,
          testerName: moduleTester?.testerName,
          resolvedTesterNames: moduleTesterNames.length > 0 ? moduleTesterNames.join('、') : undefined,
        });
      }

      // Skip project if it has no modules after filtering
      if (filteredCaseIds && moduleNodes.length === 0) continue;

      // Aggregate resolved tester names from ALL cases under this project
      const projectAllTesterNames = [...new Set(
        moduleNodes.flatMap(m => m.children?.map(c => c.testerName).filter(Boolean) ?? [])
      )];
      // Project: only show if ALL cases have the same tester (1 unique name)
      const projectResolvedTesterNames = projectAllTesterNames.length === 1
        ? projectAllTesterNames[0]
        : undefined;

      tree.push({
        id: `project-${project.id}`,
        type: 'project',
        dbId: project.id,
        name: project.name,
        children: moduleNodes,
        testerId: projectTester?.userId,
        testerName: projectTester?.testerName,
        resolvedTesterNames: projectResolvedTesterNames,
      });
    }

    return NextResponse.json({
      tree,
      username: user.username,
      isManager: MANAGER_USERNAMES.includes(user.username),
    });
  } catch (error) {
    console.error('Get tree error:', error);
    return NextResponse.json({ error: '获取目录树失败' }, { status: 500 });
  }
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
}
