import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

type AssignmentRow = {
  level: string;
  target_id: number;
  user_id: number;
  tester_name: string;
};

type ModuleStat = {
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
};

type TesterStat = {
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
  modules: ModuleStat[];
};

function roundRate(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function normalizeText(value: string | null | undefined, fallback = '未填写') {
  return value && value.trim() ? value.trim() : fallback;
}

function compareNames(a: string, b: string) {
  return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const db = getDb();

    const activeProjects = db.prepare(`
      SELECT p.id, p.name, p.start_date, p.end_date
      FROM projects p
      WHERE p.is_archived = 0
      ORDER BY p.sort_order, p.id
    `).all() as { id: number; name: string; start_date: string | null; end_date: string | null }[];

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

    const allUsers = db.prepare('SELECT id, username FROM users ORDER BY id').all() as { id: number; username: string }[];

    const projectStats = activeProjects.map(project => {
      const projectTester = assignmentMap.get(`project-${project.id}`);
      const modules = db.prepare(`
        SELECT id, name
        FROM modules
        WHERE project_id = ?
        ORDER BY sort_order, id
      `).all(project.id) as { id: number; name: string }[];

      let projectTotal = 0;
      let projectCompleted = 0;
      let projectPassed = 0;
      let projectFailed = 0;
      let projectBlocked = 0;

      const testerStatsMap = new Map<number, TesterStat>();
      const testerModuleMap = new Map<string, {
        testerId: number;
        username: string;
        moduleId: number;
        moduleName: string;
        total: number;
        completed: number;
        passed: number;
        failed: number;
        blocked: number;
      }>();
      const cases: Array<{
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
      }> = [];

      for (const mod of modules) {
        const moduleTester = assignmentMap.get(`module-${mod.id}`);
        const moduleCases = db.prepare(`
          SELECT id, case_no, case_name, feature, trait, test_category, priority, test_result, jira_link
          FROM cases
          WHERE module_id = ?
          ORDER BY sort_order, id
        `).all(mod.id) as Array<{
          id: number;
          case_no: string;
          case_name: string;
          feature: string;
          trait: string;
          test_category: string;
          priority: string;
          test_result: string | null;
          jira_link: string;
        }>;

        for (const caseItem of moduleCases) {
          const caseTester = assignmentMap.get(`case-${caseItem.id}`);
          const resolvedTester = caseTester || moduleTester || projectTester || {
            userId: 0,
            testerName: '未分配',
          };

          const isPass = caseItem.test_result === 'Pass';
          const isFail = caseItem.test_result === 'Fail';
          const isBlock = caseItem.test_result === 'Block';
          const isCompleted = isPass || isFail || isBlock;

          const testerKey = `${resolvedTester.userId}:${mod.id}`;

          projectTotal++;
          if (isCompleted) projectCompleted++;
          if (isPass) projectPassed++;
          if (isFail) projectFailed++;
          if (isBlock) projectBlocked++;

          if (!testerStatsMap.has(resolvedTester.userId)) {
            testerStatsMap.set(resolvedTester.userId, {
              userId: resolvedTester.userId,
              username: resolvedTester.testerName,
              total: 0,
              completed: 0,
              incomplete: 0,
              passed: 0,
              failed: 0,
              blocked: 0,
              completionRate: 0,
              passRate: 0,
              modules: [],
            });
          }

          const testerStats = testerStatsMap.get(resolvedTester.userId)!;
          testerStats.total++;
          if (isCompleted) testerStats.completed++;
          if (!isCompleted) testerStats.incomplete++;
          if (isPass) testerStats.passed++;
          if (isFail) testerStats.failed++;
          if (isBlock) testerStats.blocked++;

          if (!testerModuleMap.has(testerKey)) {
            testerModuleMap.set(testerKey, {
              testerId: resolvedTester.userId,
              username: resolvedTester.testerName,
              moduleId: mod.id,
              moduleName: mod.name,
              total: 0,
              completed: 0,
              passed: 0,
              failed: 0,
              blocked: 0,
            });
          }

          const moduleStats = testerModuleMap.get(testerKey)!;
          moduleStats.total++;
          if (isCompleted) moduleStats.completed++;
          if (isPass) moduleStats.passed++;
          if (isFail) moduleStats.failed++;
          if (isBlock) moduleStats.blocked++;

          cases.push({
            id: caseItem.id,
            caseNo: caseItem.case_no || '',
            caseName: caseItem.case_name,
            moduleId: mod.id,
            moduleName: mod.name,
            testerId: resolvedTester.userId,
            testerName: resolvedTester.testerName,
            feature: normalizeText(caseItem.feature || caseItem.test_category, '未填写功能'),
            trait: normalizeText(caseItem.trait, ''),
            testCategory: normalizeText(caseItem.test_category, ''),
            priority: caseItem.priority || '',
            testResult: caseItem.test_result,
            jiraLink: caseItem.jira_link || '',
          });
        }
      }

      for (const moduleStats of testerModuleMap.values()) {
        const testerStats = testerStatsMap.get(moduleStats.testerId);
        if (!testerStats) continue;
        testerStats.modules.push({
          key: `${moduleStats.moduleId}`,
          moduleId: moduleStats.moduleId,
          moduleName: moduleStats.moduleName,
          total: moduleStats.total,
          completed: moduleStats.completed,
          passed: moduleStats.passed,
          failed: moduleStats.failed,
          blocked: moduleStats.blocked,
          incomplete: moduleStats.total - moduleStats.completed,
          completionRate: roundRate(moduleStats.completed, moduleStats.total),
          passRate: roundRate(moduleStats.passed, moduleStats.completed),
        });
      }

      const testers = Array.from(testerStatsMap.values())
        .map(tester => ({
          ...tester,
          completionRate: roundRate(tester.completed, tester.total),
          passRate: roundRate(tester.passed, tester.completed),
          modules: tester.modules.sort((a, b) => compareNames(a.moduleName, b.moduleName)),
        }))
        .sort((a, b) => compareNames(a.username, b.username));

      const projectIncomplete = projectTotal - projectCompleted;
      const completionRate = roundRate(projectCompleted, projectTotal);
      const passRate = roundRate(projectPassed, projectCompleted);
      const blockedRate = roundRate(projectBlocked, projectTotal);

      return {
        id: project.id,
        name: project.name,
        startDate: project.start_date,
        endDate: project.end_date,
        total: projectTotal,
        completed: projectCompleted,
        incomplete: projectIncomplete,
        passed: projectPassed,
        failed: projectFailed,
        blocked: projectBlocked,
        completionRate,
        passRate,
        blockedRate,
        testers,
        cases,
      };
    });

    const overallTotal = projectStats.reduce((sum, project) => sum + project.total, 0);
    const overallCompleted = projectStats.reduce((sum, project) => sum + project.completed, 0);
    const overallPassed = projectStats.reduce((sum, project) => sum + project.passed, 0);
    const overallFailed = projectStats.reduce((sum, project) => sum + project.failed, 0);
    const overallBlocked = projectStats.reduce((sum, project) => sum + project.blocked, 0);

    return NextResponse.json({
      projects: projectStats,
      summary: {
        projectCount: activeProjects.length,
        total: overallTotal,
        completed: overallCompleted,
        incomplete: overallTotal - overallCompleted,
        passed: overallPassed,
        failed: overallFailed,
        blocked: overallBlocked,
        completionRate: roundRate(overallCompleted, overallTotal),
        passRate: roundRate(overallPassed, overallCompleted),
        blockedRate: roundRate(overallBlocked, overallTotal),
      },
      allUsers,
    });
  } catch (error) {
    console.error('Kanban stats error:', error);
    return NextResponse.json({ error: '获取看板数据失败' }, { status: 500 });
  }
}
