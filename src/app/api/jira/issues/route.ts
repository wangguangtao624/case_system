import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'http://jira.mtsilicon.com:8080';
const JIRA_USERNAME = process.env.JIRA_USERNAME || 'wangguangtao';
const JIRA_PASSWORD = process.env.JIRA_PASSWORD || 'txfz65qw';

type JiraIssueApiResponse = {
  key?: string;
  fields?: {
    summary?: string | null;
    priority?: { name?: string | null } | null;
    issuetype?: { name?: string | null } | null;
    status?: {
      name?: string | null;
      statusCategory?: { name?: string | null; key?: string | null } | null;
    } | null;
    resolution?: { name?: string | null } | null;
    assignee?: { displayName?: string | null; name?: string | null } | null;
  };
};

function normalizeJiraCompletion(statusName?: string | null, statusCategoryName?: string | null, statusCategoryKey?: string | null, resolutionName?: string | null) {
  const values = [
    statusName,
    statusCategoryName,
    statusCategoryKey,
    resolutionName,
  ]
    .map(value => (value || '').trim().toLowerCase())
    .filter(Boolean);

  const doneKeywords = ['完成', '已解决', 'done', 'resolved', 'complete', 'completed', 'closed'];
  const isDone = values.some(value => doneKeywords.some(keyword => value.includes(keyword)));

  return {
    statusLabel: isDone ? '完成' : '未完成',
    isDone,
  };
}

function extractIssueKey(link: string) {
  const trimmed = link.trim();
  if (!trimmed) return '';

  const browseMatch = trimmed.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)(?:[/?#]|$)/i);
  if (browseMatch?.[1]) return browseMatch[1].toUpperCase();

  const directMatch = trimmed.match(/\b([A-Z][A-Z0-9_]+-\d+)\b/i);
  if (directMatch?.[1]) return directMatch[1].toUpperCase();

  return '';
}

async function fetchIssue(link: string) {
  const issueKey = extractIssueKey(link);
  if (!issueKey) {
    return {
      link,
      issueKey: 'JIRA',
      summary: '无法从链接中识别 JIRA 单号',
      priority: '未知优先级',
      issueType: '未知类型',
      resolution: '未完成',
      assigneeName: '未知',
      statusCategory: '未完成',
      isDone: false,
    };
  }

  const auth = Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString('base64');
  const response = await fetch(`${JIRA_BASE_URL}/rest/api/2/issue/${issueKey}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return {
      link,
      issueKey,
      summary: 'JIRA 信息获取失败',
      priority: '未知优先级',
      issueType: '未知类型',
      resolution: '未完成',
      assigneeName: '未知',
      statusCategory: '未完成',
      isDone: false,
    };
  }

  const issue = await response.json() as JiraIssueApiResponse;
  const normalized = normalizeJiraCompletion(
    issue.fields?.status?.name,
    issue.fields?.status?.statusCategory?.name,
    issue.fields?.status?.statusCategory?.key,
    issue.fields?.resolution?.name,
  );

  return {
    link,
    issueKey: issue.key || issueKey,
    summary: issue.fields?.summary?.trim() || '未获取到标题',
    priority: issue.fields?.priority?.name?.trim() || '未知优先级',
    issueType: issue.fields?.issuetype?.name?.trim() || '未知类型',
    resolution: normalized.statusLabel,
    assigneeName: issue.fields?.assignee?.displayName?.trim() || issue.fields?.assignee?.name?.trim() || '未分配',
    statusCategory: normalized.statusLabel,
    isDone: normalized.isDone,
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const links: string[] = Array.isArray(body?.links)
      ? body.links
        .map((item: unknown) => String(item || '').trim())
        .filter((item: string): item is string => item.length > 0)
      : [];

    if (links.length === 0) {
      return NextResponse.json({ issues: [] });
    }

    const uniqueLinks = Array.from(new Set(links));
    const issues = await Promise.all(uniqueLinks.map(link => fetchIssue(link)));

    return NextResponse.json({ issues });
  } catch (error) {
    console.error('JIRA issues API error:', error);
    return NextResponse.json({ error: '获取 JIRA 信息失败' }, { status: 500 });
  }
}
