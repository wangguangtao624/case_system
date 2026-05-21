import path from 'path';

export function getWorkspaceRoot(): string {
  return process.env.APP_WORKSPACE_PATH
    || process.env.COZE_WORKSPACE_PATH
    || process.cwd();
}

export function getRuntimeMode(): 'development' | 'production' {
  const raw = process.env.APP_RUNTIME_ENV
    || process.env.COZE_PROJECT_ENV
    || process.env.NODE_ENV
    || 'development';
  const normalized = raw.toLowerCase();
  return normalized === 'prod' || normalized === 'production' ? 'production' : 'development';
}

export function resolveWorkspacePath(...segments: string[]): string {
  return path.join(getWorkspaceRoot(), ...segments);
}
