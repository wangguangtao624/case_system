const JIRA_LINK_SEPARATOR = /\r?\n|[，,](?=\s*https?:\/\/)/i;

export function parseJiraLinks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(parseJiraLinks);
  }
  if (typeof value !== 'string') return [];

  return value
    .split(JIRA_LINK_SEPARATOR)
    .map(link => link.trim())
    .filter(Boolean);
}

export function serializeJiraLinks(value: unknown): string {
  return parseJiraLinks(value).join('\n');
}

export function isHttpJiraLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
