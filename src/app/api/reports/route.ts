import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getOrCreateReportCode } from '@/lib/report-data';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const scope = body.scope as 'project' | 'feature' | 'case';
    if (!['project', 'feature', 'case'].includes(scope)) return NextResponse.json({ error: '报告范围参数错误' }, { status: 400 });

    const db = getDb();
    let projectId = Number(body.projectId || 0);
    let moduleId: number | undefined;
    let caseId: number | undefined;
    if (scope === 'feature') {
      moduleId = Number(body.moduleId || 0);
      const moduleRow = db.prepare('SELECT project_id FROM modules WHERE id = ?').get(moduleId) as { project_id: number } | undefined;
      if (!moduleRow) return NextResponse.json({ error: '特性不存在' }, { status: 404 });
      projectId = moduleRow.project_id;
    } else if (scope === 'case') {
      caseId = Number(body.caseId || 0);
      const item = db.prepare('SELECT m.project_id FROM cases c JOIN modules m ON m.id = c.module_id WHERE c.id = ?').get(caseId) as { project_id: number } | undefined;
      if (!item) return NextResponse.json({ error: 'Case不存在' }, { status: 404 });
      projectId = item.project_id;
    }

    const project = db.prepare('SELECT id, publish_status FROM projects WHERE id = ?').get(projectId) as { id: number; publish_status: string } | undefined;
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    if (project.publish_status === 'draft') return NextResponse.json({ error: '未发布项目不能分享报告' }, { status: 400 });

    const code = getOrCreateReportCode({ scope, projectId, moduleId, caseId, createdBy: user.username });
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '') || 'http';
    const reportUrl = host ? `${protocol}://${host}/report/${code}` : new URL(`/report/${code}`, request.url).toString();
    return NextResponse.json({ success: true, code, reportUrl, downloadUrl: `/api/reports/${code}/download` });
  } catch (error) {
    console.error('Create report link error:', error);
    return NextResponse.json({ error: '复制报告链接失败' }, { status: 500 });
  }
}
