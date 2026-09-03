import 'server-only';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'http://jira.mtsilicon.com:8080';
const JIRA_USERNAME = process.env.JIRA_USERNAME || 'wangguangtao';
const JIRA_PASSWORD = process.env.JIRA_PASSWORD || 'txfz65qw';
const CACHE_TTL = 2 * 60 * 1000;

export interface JiraIssueInfo {
  link: string; issueKey: string; summary: string; priority: string; issueType: string;
  resolution: string; assigneeName: string; reporterName: string; statusName: string;
  projectName: string; updated: string; statusCategory: string; isDone: boolean;
}

type JiraResponse = { key?: string; fields?: { summary?: string | null; priority?: { name?: string | null } | null; issuetype?: { name?: string | null } | null; status?: { name?: string | null; statusCategory?: { name?: string | null; key?: string | null } | null } | null; resolution?: { name?: string | null } | null; assignee?: { displayName?: string | null; name?: string | null } | null; reporter?: { displayName?: string | null; name?: string | null } | null; updated?: string | null; project?: { name?: string | null } | null } };
const cache = new Map<string, { expires: number; value: Promise<JiraIssueInfo> }>();

function issueKey(link: string) {
  return (link.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)(?:[/?#]|$)/i)?.[1] || link.match(/\b([A-Z][A-Z0-9_]+-\d+)\b/i)?.[1] || '').toUpperCase();
}

function fallback(link: string, key: string, summary: string): JiraIssueInfo {
  return { link, issueKey: key || 'JIRA', summary, priority: '未知优先级', issueType: '未知类型', resolution: '未完成', assigneeName: '未知', reporterName: '未知', statusName: '未知', projectName: '未知项目', updated: '', statusCategory: '未完成', isDone: false };
}

async function fetchOne(link: string): Promise<JiraIssueInfo> {
  const key = issueKey(link);
  if (!key) return fallback(link, key, '无法从链接中识别 JIRA 单号');
  try {
    const auth = Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString('base64');
    const response = await fetch(`${JIRA_BASE_URL}/rest/api/2/issue/${key}`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return fallback(link, key, 'JIRA 信息获取失败');
    const issue = await response.json() as JiraResponse;
    const values = [issue.fields?.status?.name, issue.fields?.status?.statusCategory?.name, issue.fields?.status?.statusCategory?.key, issue.fields?.resolution?.name].map(value => (value || '').toLowerCase());
    const done = values.some(value => ['完成', '已解决', 'done', 'resolved', 'complete', 'closed'].some(word => value.includes(word)));
    return { link, issueKey: issue.key || key, summary: issue.fields?.summary?.trim() || '未获取到标题', priority: issue.fields?.priority?.name?.trim() || '未知优先级', issueType: issue.fields?.issuetype?.name?.trim() || '未知类型', resolution: done ? '完成' : '未完成', assigneeName: issue.fields?.assignee?.displayName?.trim() || issue.fields?.assignee?.name?.trim() || '未分配', reporterName: issue.fields?.reporter?.displayName?.trim() || issue.fields?.reporter?.name?.trim() || '未知', statusName: issue.fields?.status?.name?.trim() || (done ? '完成' : '未完成'), projectName: issue.fields?.project?.name?.trim() || '未知项目', updated: issue.fields?.updated || '', statusCategory: done ? '完成' : '未完成', isDone: done };
  } catch {
    return fallback(link, key, 'JIRA 服务暂时不可用');
  }
}

function cached(link: string) {
  const now = Date.now();
  const existing = cache.get(link);
  if (existing && existing.expires > now) return existing.value;
  const value = fetchOne(link);
  cache.set(link, { expires: now + CACHE_TTL, value });
  return value;
}

export async function fetchJiraIssues(links: string[]): Promise<JiraIssueInfo[]> {
  const unique = Array.from(new Set(links.filter(Boolean)));
  const result: JiraIssueInfo[] = [];
  for (let index = 0; index < unique.length; index += 6) result.push(...await Promise.all(unique.slice(index, index + 6).map(cached)));
  return result;
}
