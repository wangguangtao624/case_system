import { NextResponse } from 'next/server';
import { verifyReportToken } from '@/lib/auth';
import { loadReportData } from '@/lib/report-data';
import { buildOfflineReportHtml } from '@/lib/report-html';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const payload = await verifyReportToken(token);
    if (!payload) return NextResponse.json({ error: '报告链接无效' }, { status: 404 });
    const report = loadReportData(payload);
    if (!report) return NextResponse.json({ error: '报告不存在' }, { status: 404 });
    const safeName = report.project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '测试报告';
    return new NextResponse(buildOfflineReportHtml(report), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}-${report.scopeLabel}-测试报告.html`)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Download report error:', error);
    return NextResponse.json({ error: '生成离线报告失败' }, { status: 500 });
  }
}
