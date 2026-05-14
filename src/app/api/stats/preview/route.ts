import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser, isManagerUser } from '@/lib/auth';

type AssignmentRow = {
  level: string;
  target_id: number;
  user_id: number;
  tester_name: string;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level'); // 'project' or 'module'
    const id = searchParams.get('id');
    const prioritiesParam = searchParams.get('priorities'); // comma-separated, e.g. 'High,Middle'

    if (!level || !id) return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    if (!['project', 'module'].includes(level)) return NextResponse.json({ error: '层级参数错误' }, { status: 400 });

    const db = getDb();
    const dbId = Number(id);
    const assignments = db.prepare(`
      SELECT a.level, a.target_id, a.user_id, u.username as tester_name
      FROM assignments a
      JOIN users u ON a.user_id = u.id
    `).all() as AssignmentRow[];
    const assignmentMap = new Map<string, { userId: number; testerName: string }>();
    for (const assignment of assignments) {
      assignmentMap.set(`${assignment.level}-${assignment.target_id}`, {
        userId: assignment.user_id,
        testerName: assignment.tester_name,
      });
    }

    // Parse priority filter
    const selectedPriorities = prioritiesParam
      ? prioritiesParam.split(',').filter((p: string) => ['High', 'Middle', 'Low'].includes(p))
      : null;

    if (level === 'project') {
      // Check permission: project exists
      const project = db.prepare('SELECT id, publish_status FROM projects WHERE id = ?').get(dbId) as { id: number; publish_status: string } | undefined;
      if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
      if (project.publish_status === 'draft' && !isManagerUser(user.username)) {
        return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
      }

      // Get all modules under this project
      const modules = db.prepare('SELECT id, name FROM modules WHERE project_id = ? ORDER BY sort_order, id').all(dbId) as { id: number; name: string }[];

      const moduleStats: Array<{
        id: number;
        name: string;
        testerNames: string;
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
      }> = [];

      let projectTotal = 0;
      let projectCompleted = 0;
      let projectIncomplete = 0;
      let projectPassed = 0;
      let projectFailed = 0;
      let projectBlocked = 0;

      for (const mod of modules) {
        const projectTester = assignmentMap.get(`project-${dbId}`);
        const moduleTester = assignmentMap.get(`module-${mod.id}`);
        let cases = db.prepare('SELECT id, test_result, priority FROM cases WHERE module_id = ?').all(mod.id) as { id: number; test_result: string | null; priority: string }[];
        // Apply priority filter
        if (selectedPriorities) {
          cases = cases.filter(c => selectedPriorities.includes(c.priority));
        }
        const testerNames = [...new Set(cases.map(c => {
          const caseTester = assignmentMap.get(`case-${c.id}`);
          return (caseTester || moduleTester || projectTester)?.testerName || '未分配';
        }))];
        const total = cases.length;
        const passed = cases.filter(c => c.test_result === 'Pass').length;
        const failed = cases.filter(c => c.test_result === 'Fail').length;
        const blocked = cases.filter(c => c.test_result === 'Block').length;
        const completed = passed + failed + blocked; // Blocked is counted as completed
        const incomplete = total - completed;
        const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
        const passRate = completed > 0 ? Math.round((passed / completed) * 1000) / 10 : 0;
        const completedPassRate = passRate; // same: passed / completed
        const blockedRate = total > 0 ? Math.round((blocked / total) * 1000) / 10 : 0;

        moduleStats.push({
          id: mod.id,
          name: mod.name,
          testerNames: testerNames.join('、'),
          total,
          completed,
          incomplete,
          passed,
          failed,
          blocked,
          completionRate,
          passRate,
          completedPassRate,
          blockedRate,
        });

        projectTotal += total;
        projectCompleted += completed;
        projectIncomplete += incomplete;
        projectPassed += passed;
        projectFailed += failed;
        projectBlocked += blocked;
      }

      const projectCompletionRate = projectTotal > 0 ? Math.round((projectCompleted / projectTotal) * 1000) / 10 : 0;
      const projectPassRate = projectCompleted > 0 ? Math.round((projectPassed / projectCompleted) * 1000) / 10 : 0;
      const projectCompletedPassRate = projectPassRate;
      const projectBlockedRate = projectTotal > 0 ? Math.round((projectBlocked / projectTotal) * 1000) / 10 : 0;

      return NextResponse.json({
        level: 'project',
        id: dbId,
        summary: {
          total: projectTotal,
          completed: projectCompleted,
          incomplete: projectIncomplete,
          passed: projectPassed,
          failed: projectFailed,
          blocked: projectBlocked,
          completionRate: projectCompletionRate,
          passRate: projectPassRate,
          completedPassRate: projectCompletedPassRate,
          blockedRate: projectBlockedRate,
        },
        modules: moduleStats,
        jiraLinks: getJiraLinks(db, dbId, selectedPriorities),
      });
    }

    if (level === 'module') {
      // Check permission: module exists
      const moduleRow = db.prepare(`
        SELECT m.id, m.name, p.publish_status FROM modules m
        JOIN projects p ON m.project_id = p.id
        WHERE m.id = ?
      `).get(dbId) as { id: number; name: string; publish_status: string } | undefined;
      if (!moduleRow) return NextResponse.json({ error: '模块不存在' }, { status: 404 });
      if (moduleRow.publish_status === 'draft' && !isManagerUser(user.username)) {
        return NextResponse.json({ error: '未发布项目暂不可见' }, { status: 403 });
      }

      // Get all cases under this module
      let cases = db.prepare('SELECT id, case_name, test_result, priority FROM cases WHERE module_id = ? ORDER BY sort_order, id').all(dbId) as {
        id: number;
        case_name: string;
        test_result: string | null;
        priority: string;
      }[];
      const projectRow = db.prepare(`
        SELECT p.id as project_id FROM modules m
        JOIN projects p ON m.project_id = p.id
        WHERE m.id = ?
      `).get(dbId) as { project_id: number } | undefined;
      const projectTester = projectRow ? assignmentMap.get(`project-${projectRow.project_id}`) : undefined;
      const moduleTester = assignmentMap.get(`module-${dbId}`);

      // Apply priority filter
      if (selectedPriorities) {
        cases = cases.filter(c => selectedPriorities.includes(c.priority));
      }

      const total = cases.length;
      const passed = cases.filter(c => c.test_result === 'Pass').length;
      const failed = cases.filter(c => c.test_result === 'Fail').length;
      const blocked = cases.filter(c => c.test_result === 'Block').length;
      const completed = passed + failed + blocked; // Blocked is counted as completed
      const incomplete = total - completed;
      const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
      const passRate = completed > 0 ? Math.round((passed / completed) * 1000) / 10 : 0;
      const completedPassRate = passRate;
      const blockedRate = total > 0 ? Math.round((blocked / total) * 1000) / 10 : 0;

      const caseList = cases.map(c => ({
        id: c.id,
        case_name: c.case_name,
        test_result: c.test_result,
        priority: c.priority,
        testerName: (assignmentMap.get(`case-${c.id}`) || moduleTester || projectTester)?.testerName || '未分配',
        status: !c.test_result ? 'incomplete' : c.test_result === 'Pass' ? 'passed' : c.test_result === 'Fail' ? 'failed' : c.test_result === 'Block' ? 'blocked' : 'incomplete',
      }));
      const testerNames = [...new Set(caseList.map(c => c.testerName))];

      return NextResponse.json({
        level: 'module',
        id: dbId,
        name: moduleRow.name,
        testerNames,
        summary: {
          total,
          completed,
          incomplete,
          passed,
          failed,
          blocked,
          completionRate,
          passRate,
          completedPassRate,
          blockedRate,
        },
        cases: caseList,
      });
    }

    return NextResponse.json({ error: '无效参数' }, { status: 400 });
  } catch (error) {
    console.error('Stats preview error:', error);
    return NextResponse.json({ error: '获取统计数据失败' }, { status: 500 });
  }
}

function getJiraLinks(db: ReturnType<typeof getDb>, projectId: number, selectedPriorities: string[] | null) {
  // Get all cases with non-empty jira_link under this project
  let cases = db.prepare(`
    SELECT c.id, c.case_name, c.jira_link, c.test_result, c.priority, m.name as module_name
    FROM cases c
    JOIN modules m ON c.module_id = m.id
    WHERE m.project_id = ? AND c.jira_link IS NOT NULL AND c.jira_link != ''
    ORDER BY c.jira_link, c.id
  `).all(projectId) as { id: number; case_name: string; jira_link: string; test_result: string | null; priority: string; module_name: string }[];

  // Apply priority filter
  if (selectedPriorities) {
    cases = cases.filter(c => selectedPriorities.includes(c.priority));
  }

  // Group by jira_link (deduplicated)
  const jiraMap = new Map<string, { link: string; cases: Array<{ id: number; case_name: string; test_result: string | null; module_name: string }> }>();
  for (const c of cases) {
    // Normalize: trim and handle multiple links (split by comma/newline)
    const links = c.jira_link.split(/[,，\n]/).map(l => l.trim()).filter(l => l.length > 0);
    for (const link of links) {
      if (!jiraMap.has(link)) {
        jiraMap.set(link, { link, cases: [] });
      }
      jiraMap.get(link)!.cases.push({
        id: c.id,
        case_name: c.case_name,
        test_result: c.test_result,
        module_name: c.module_name,
      });
    }
  }

  return Array.from(jiraMap.values());
}
