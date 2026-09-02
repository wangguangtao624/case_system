import { NextRequest, NextResponse } from 'next/server';
import { createReportToken, getCurrentUser, isManagerUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!isManagerUser(user.username)) return NextResponse.json({ error: '无生成项目报告权限' }, { status: 403 });

    const projectId = Number(new URL(request.url).searchParams.get('projectId'));
    if (!projectId) return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
    const db = getDb();
    const project = db.prepare('SELECT id, name, is_archived, publish_status FROM projects WHERE id = ?').get(projectId) as { id: number; name: string; is_archived: number; publish_status: string } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const features = db.prepare(`
      SELECT DISTINCT TRIM(COALESCE(c.feature, '')) AS feature
      FROM cases c JOIN modules m ON m.id = c.module_id
      WHERE m.project_id = ? AND TRIM(COALESCE(c.feature, '')) != ''
      ORDER BY feature
    `).all(projectId) as Array<{ feature: string }>;
    const cases = db.prepare(`
      SELECT c.id, c.case_no, c.case_name, c.feature, m.name AS module_name
      FROM cases c JOIN modules m ON m.id = c.module_id
      WHERE m.project_id = ? ORDER BY m.sort_order, m.id, c.sort_order, c.id
    `).all(projectId);

    return NextResponse.json({
      project: { id: project.id, name: project.name, isArchived: project.is_archived === 1 || project.publish_status === 'archived' },
      features: features.map(item => item.feature),
      cases,
    });
  } catch (error) {
    console.error('Get report options error:', error);
    return NextResponse.json({ error: '获取报告范围失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const body = await request.json();
    const projectId = Number(body.projectId);
    const scope = body.scope as 'project' | 'feature' | 'case';
    if (!projectId || !['project', 'feature', 'case'].includes(scope)) {
      return NextResponse.json({ error: '报告范围参数错误' }, { status: 400 });
    }

    const db = getDb();
    const project = db.prepare('SELECT id, is_archived, publish_status FROM projects WHERE id = ?').get(projectId) as { id: number; is_archived: number; publish_status: string } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    if (project.publish_status === 'draft') return NextResponse.json({ error: '未发布项目不能生成只读报告' }, { status: 400 });

    const manager = isManagerUser(user.username);
    let feature: string | undefined;
    let caseId: number | undefined;
    if (scope === 'project' || scope === 'feature') {
      if (!manager) return NextResponse.json({ error: '仅管理者可生成项目或特性报告' }, { status: 403 });
      if (!project.is_archived && project.publish_status !== 'archived') {
        return NextResponse.json({ error: '项目或特性报告需在项目归档后生成' }, { status: 400 });
      }
      if (scope === 'feature') {
        feature = typeof body.feature === 'string' ? body.feature.trim() : '';
        const exists = db.prepare(`SELECT 1 FROM cases c JOIN modules m ON m.id = c.module_id WHERE m.project_id = ? AND COALESCE(c.feature, '') = ? LIMIT 1`).get(projectId, feature);
        if (!feature || !exists) return NextResponse.json({ error: '所选特性不存在' }, { status: 400 });
      }
    } else {
      caseId = Number(body.caseId);
      const item = db.prepare(`
        SELECT c.id,
          COALESCE(ca.user_id, ma.user_id, pa.user_id) AS tester_id
        FROM cases c JOIN modules m ON m.id = c.module_id
        LEFT JOIN assignments ca ON ca.level = 'case' AND ca.target_id = c.id
        LEFT JOIN assignments ma ON ma.level = 'module' AND ma.target_id = m.id
        LEFT JOIN assignments pa ON pa.level = 'project' AND pa.target_id = m.project_id
        WHERE c.id = ? AND m.project_id = ?
      `).get(caseId, projectId) as { id: number; tester_id: number | null } | undefined;
      if (!item) return NextResponse.json({ error: 'Case不存在或不属于该项目' }, { status: 400 });
      if (!manager && item.tester_id !== user.id) return NextResponse.json({ error: '无生成此Case报告的权限' }, { status: 403 });
    }

    const token = await createReportToken({ scope, projectId, feature, caseId, createdBy: user.username });
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '') || 'http';
    const reportUrl = host ? `${protocol}://${host}/report/${token}` : new URL(`/report/${token}`, request.url).toString();
    return NextResponse.json({ success: true, token, reportUrl, downloadUrl: `/api/reports/${token}/download` });
  } catch (error) {
    console.error('Create report link error:', error);
    return NextResponse.json({ error: '生成报告链接失败' }, { status: 500 });
  }
}
