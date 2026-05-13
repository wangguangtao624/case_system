import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'http://jira.mtsilicon.com:8080';
const JIRA_USERNAME = process.env.JIRA_USERNAME || 'wangguangtao';
const JIRA_PASSWORD = process.env.JIRA_PASSWORD || 'txfz65qw';

type JiraSearchIssueApi = {
  key: string;
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
    reporter?: { displayName?: string | null; name?: string | null } | null;
    creator?: { displayName?: string | null; name?: string | null } | null;
    created?: string | null;
    updated?: string | null;
    project?: { key?: string | null; name?: string | null } | null;
  };
};

type JiraSearchResponse = {
  total: number;
  issues: JiraSearchIssueApi[];
};

function normalizeJiraCompletion(statusName?: string | null, statusCategoryName?: string | null, statusCategoryKey?: string | null, resolutionName?: string | null) {
  const values = [statusName, statusCategoryName, statusCategoryKey, resolutionName]
    .map(value => (value || '').trim().toLowerCase())
    .filter(Boolean);
  const doneKeywords = ['完成', '已解决', 'done', 'resolved', 'complete', 'completed', 'closed'];
  const isDone = values.some(value => doneKeywords.some(keyword => value.includes(keyword)));
  return {
    statusLabel: isDone ? '完成' : '未完成',
    isDone,
  };
}

function escapeJqlValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function matchesUser(candidate: { displayName?: string | null; name?: string | null } | null | undefined, username: string) {
  const displayName = candidate?.displayName?.trim() || '';
  const loginName = candidate?.name?.trim() || '';
  return displayName === username || loginName === username;
}

async function searchIssuesForUser(username: string) {
  const escapedName = escapeJqlValue(username);
  const auth = Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString('base64');
  const fields = 'summary,priority,issuetype,status,resolution,assignee,reporter,creator,created,updated,project';
  const issues: JiraSearchIssueApi[] = [];
  let startAt = 0;
  let total = 0;

  do {
    const params = new URLSearchParams({
      jql: `(reporter = "${escapedName}" OR assignee = "${escapedName}" OR creator = "${escapedName}") ORDER BY updated DESC`,
      startAt: String(startAt),
      maxResults: '100',
      fields,
    });

    const response = await fetch(`${JIRA_BASE_URL}/rest/api/2/search?${params.toString()}`, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`JIRA search failed for ${username}: ${response.status}`);
    }

    const data = await response.json() as JiraSearchResponse;
    total = data.total || 0;
    issues.push(...(data.issues || []));
    startAt += (data.issues || []).length;
    if ((data.issues || []).length === 0) break;
  } while (startAt < total);

  return issues.map(issue => {
    const normalized = normalizeJiraCompletion(
      issue.fields?.status?.name,
      issue.fields?.status?.statusCategory?.name,
      issue.fields?.status?.statusCategory?.key,
      issue.fields?.resolution?.name,
    );

    const roleMatches = [];
    if (matchesUser(issue.fields?.assignee, username)) roleMatches.push('assignee');
    if (matchesUser(issue.fields?.reporter, username)) roleMatches.push('reporter');
    if (matchesUser(issue.fields?.creator, username)) roleMatches.push('creator');

    return {
      key: issue.key,
      link: `${JIRA_BASE_URL}/browse/${issue.key}`,
      summary: issue.fields?.summary?.trim() || '未获取到标题',
      priority: issue.fields?.priority?.name?.trim() || '未知优先级',
      issueType: issue.fields?.issuetype?.name?.trim() || '未知类型',
      resolution: normalized.statusLabel,
      isDone: normalized.isDone,
      statusName: issue.fields?.status?.name?.trim() || normalized.statusLabel,
      assigneeName: issue.fields?.assignee?.displayName?.trim() || issue.fields?.assignee?.name?.trim() || '未分配',
      reporterName: issue.fields?.reporter?.displayName?.trim() || issue.fields?.reporter?.name?.trim() || '未知',
      creatorName: issue.fields?.creator?.displayName?.trim() || issue.fields?.creator?.name?.trim() || '未知',
      created: issue.fields?.created || '',
      updated: issue.fields?.updated || '',
      projectKey: issue.fields?.project?.key?.trim() || '',
      projectName: issue.fields?.project?.name?.trim() || '未知项目',
      roleMatches,
    };
  });
}

export async function GET(_request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const db = getDb();
    const users = db.prepare('SELECT id, username FROM users ORDER BY id').all() as Array<{ id: number; username: string }>;

    const userSummaries = await Promise.all(users.map(async user => {
      const issues = await searchIssuesForUser(user.username);
      const done = issues.filter(issue => issue.isDone).length;
      const open = issues.length - done;
      const high = issues.filter(issue => ['high', 'highest'].includes(issue.priority.toLowerCase())).length;
      const projectsCount = new Set(issues.map(issue => issue.projectKey || issue.projectName)).size;
      return {
        userId: user.id,
        username: user.username,
        total: issues.length,
        done,
        open,
        high,
        projectsCount,
        issues,
      };
    }));

    const overall = userSummaries.reduce((acc, user) => ({
      users: acc.users + 1,
      total: acc.total + user.total,
      done: acc.done + user.done,
      open: acc.open + user.open,
      high: acc.high + user.high,
    }), { users: 0, total: 0, done: 0, open: 0, high: 0 });

    const projects = Array.from(new Set(
      userSummaries.flatMap(user => user.issues.map(issue => issue.projectName)).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'zh-CN'));

    return NextResponse.json({
      summary: overall,
      users: userSummaries,
      projects,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('JIRA board API error:', error);
    return NextResponse.json({ error: '获取 JIRA 看板失败' }, { status: 500 });
  }
}
