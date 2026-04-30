import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { id } = await params;
    const caseId = Number(id);

    const db = getDb();
    const caseData = db.prepare(`
      SELECT c.*, m.name as module_name, m.id as module_id, p.name as project_name, p.id as project_id
      FROM cases c
      JOIN modules m ON c.module_id = m.id
      JOIN projects p ON m.project_id = p.id
      WHERE c.id = ?
    `).get(caseId);

    if (!caseData) return NextResponse.json({ error: '用例不存在' }, { status: 404 });

    const files = db.prepare('SELECT * FROM files WHERE case_id = ? ORDER BY created_at').all(caseId);

    // Resolve tester for this case (case > module > project assignment)
    const testerInfo = db.prepare(`
      SELECT 
        COALESCE(ca.user_id, ma.user_id, pa.user_id) as tester_id,
        COALESCE(ca_u.username, ma_u.username, pa_u.username) as tester_name,
        COALESCE(
          CASE WHEN ca.user_id IS NOT NULL THEN 'case'
               WHEN ma.user_id IS NOT NULL THEN 'module'
               WHEN pa.user_id IS NOT NULL THEN 'project'
          END, 'none'
        ) as assignment_level
      FROM cases c
      JOIN modules m ON c.module_id = m.id
      JOIN projects p ON m.project_id = p.id
      LEFT JOIN assignments ca ON ca.level = 'case' AND ca.target_id = c.id
      LEFT JOIN users ca_u ON ca.user_id = ca_u.id
      LEFT JOIN assignments ma ON ma.level = 'module' AND ma.target_id = c.module_id
      LEFT JOIN users ma_u ON ma.user_id = ma_u.id
      LEFT JOIN assignments pa ON pa.level = 'project' AND pa.target_id = p.id
      LEFT JOIN users pa_u ON pa.user_id = pa_u.id
      WHERE c.id = ?
    `).get(caseId) as { tester_id: number | null; tester_name: string | null; assignment_level: string } | undefined;

    const isManager = MANAGER_USERNAMES.includes(user.username);
    // Check if current user is the assigned tester for this case
    const isAssignedTester = testerInfo?.tester_id === user.id;

    return NextResponse.json({
      case: caseData,
      files,
      tester: testerInfo?.tester_id ? {
        id: testerInfo.tester_id,
        name: testerInfo.tester_name,
        assignmentLevel: testerInfo.assignment_level,
      } : null,
      permissions: {
        isManager,
        isAssignedTester,
        canEditCore: isManager,
        canEditResult: isManager || isAssignedTester,
      },
    });
  } catch (error) {
    console.error('Get case detail error:', error);
    return NextResponse.json({ error: '获取用例详情失败' }, { status: 500 });
  }
}
