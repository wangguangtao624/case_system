import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const db = getDb();

    const activeProjects = db.prepare(`
      SELECT p.id, p.name, p.start_date, p.end_date FROM projects p WHERE p.is_archived = 0 ORDER BY p.sort_order, p.id
    `).all() as { id: number; name: string; start_date: string | null; end_date: string | null }[];

    const assignments = db.prepare(`
      SELECT a.level, a.target_id, a.user_id, u.username as tester_name
      FROM assignments a
      JOIN users u ON a.user_id = u.id
    `).all() as { level: string; target_id: number; user_id: number; tester_name: string }[];

    const assignmentMap = new Map<string, { userId: number; testerName: string }>();
    for (const a of assignments) {
      assignmentMap.set(`${a.level}-${a.target_id}`, { userId: a.user_id, testerName: a.tester_name });
    }

    const allUsers = db.prepare('SELECT id, username FROM users ORDER BY id').all() as { id: number; username: string }[];

    const projectStats = [];

    for (const project of activeProjects) {
      const projectTester = assignmentMap.get(`project-${project.id}`);
      const modules = db.prepare('SELECT id, name FROM modules WHERE project_id = ? ORDER BY sort_order, id').all(project.id) as { id: number; name: string }[];

      let projectTotal = 0;
      let projectCompleted = 0;
      let projectPassed = 0;
      let projectFailed = 0;
      let projectBlocked = 0;

      const testerStatsMap = new Map<number, { userId: number; username: string; total: number; completed: number; passed: number; failed: number; blocked: number }>();

      for (const mod of modules) {
        const moduleTester = assignmentMap.get(`module-${mod.id}`);
        const cases = db.prepare('SELECT id, test_result, priority FROM cases WHERE module_id = ?').all(mod.id) as { id: number; test_result: string | null; priority: string }[];

        for (const c of cases) {
          const caseTester = assignmentMap.get(`case-${c.id}`);
          const resolvedTester = caseTester || moduleTester || projectTester;

          const isPass = c.test_result === 'Pass';
          const isFail = c.test_result === 'Fail';
          const isBlock = c.test_result === 'Block';
          const isCompleted = isPass || isFail || isBlock;

          projectTotal++;
          if (isCompleted) projectCompleted++;
          if (isPass) projectPassed++;
          if (isFail) projectFailed++;
          if (isBlock) projectBlocked++;

          if (resolvedTester) {
            if (!testerStatsMap.has(resolvedTester.userId)) {
              testerStatsMap.set(resolvedTester.userId, {
                userId: resolvedTester.userId,
                username: resolvedTester.testerName,
                total: 0,
                completed: 0,
                passed: 0,
                failed: 0,
                blocked: 0,
              });
            }
            const ts = testerStatsMap.get(resolvedTester.userId)!;
            ts.total++;
            if (isCompleted) ts.completed++;
            if (isPass) ts.passed++;
            if (isFail) ts.failed++;
            if (isBlock) ts.blocked++;
          }
        }
      }

      const projectIncomplete = projectTotal - projectCompleted;
      const completionRate = projectTotal > 0 ? Math.round((projectCompleted / projectTotal) * 1000) / 10 : 0;
      const passRate = projectCompleted > 0 ? Math.round((projectPassed / projectCompleted) * 1000) / 10 : 0;
      const blockedRate = projectTotal > 0 ? Math.round((projectBlocked / projectTotal) * 1000) / 10 : 0;

      projectStats.push({
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
        testers: Array.from(testerStatsMap.values()).map(ts => ({
          ...ts,
          completionRate: ts.total > 0 ? Math.round((ts.completed / ts.total) * 1000) / 10 : 0,
          passRate: ts.completed > 0 ? Math.round((ts.passed / ts.completed) * 1000) / 10 : 0,
        })),
      });
    }

    const overallTotal = projectStats.reduce((s, p) => s + p.total, 0);
    const overallCompleted = projectStats.reduce((s, p) => s + p.completed, 0);
    const overallPassed = projectStats.reduce((s, p) => s + p.passed, 0);
    const overallFailed = projectStats.reduce((s, p) => s + p.failed, 0);
    const overallBlocked = projectStats.reduce((s, p) => s + p.blocked, 0);

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
        completionRate: overallTotal > 0 ? Math.round((overallCompleted / overallTotal) * 1000) / 10 : 0,
        passRate: overallCompleted > 0 ? Math.round((overallPassed / overallCompleted) * 1000) / 10 : 0,
        blockedRate: overallTotal > 0 ? Math.round((overallBlocked / overallTotal) * 1000) / 10 : 0,
      },
      allUsers,
    });
  } catch (error) {
    console.error('Kanban stats error:', error);
    return NextResponse.json({ error: '获取看板数据失败' }, { status: 500 });
  }
}
