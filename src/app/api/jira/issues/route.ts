import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { fetchJiraIssues } from '@/lib/jira-issues';

export async function POST(request: NextRequest) {
  try {
    if (!await getCurrentUser()) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const links = Array.isArray(body?.links) ? body.links.map((item: unknown) => String(item || '').trim()).filter(Boolean) : [];
    return NextResponse.json({ issues: await fetchJiraIssues(links) });
  } catch (error) {
    console.error('JIRA issues API error:', error);
    return NextResponse.json({ error: '获取 JIRA 信息失败' }, { status: 500 });
  }
}
