import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveWorkspacePath } from '@/lib/runtime';

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (secret) return new TextEncoder().encode(secret);

  const secretPath = resolveWorkspacePath('data', '.jwt_secret');
  if (fs.existsSync(secretPath)) {
    const stored = fs.readFileSync(secretPath, 'utf-8').trim();
    if (stored) return new TextEncoder().encode(stored);
  }

  const generated = crypto.randomBytes(32).toString('hex');
  const dir = path.dirname(secretPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  return new TextEncoder().encode(generated);
}

const SECRET = getJwtSecret();

export const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'] as const;

export interface UserPayload {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface ReportTokenPayload {
  kind: 'report';
  scope: 'project' | 'feature' | 'case';
  projectId: number;
  feature?: string;
  caseId?: number;
  createdBy: string;
}

export async function createToken(payload: UserPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<UserPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return {
      id: payload.id as number,
      username: payload.username as string,
      role: payload.role as 'admin' | 'user',
    };
  } catch {
    return null;
  }
}

export async function createReportToken(payload: Omit<ReportTokenPayload, 'kind'>): Promise<string> {
  return new SignJWT({ ...payload, kind: 'report' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(SECRET);
}

export async function verifyReportToken(token: string): Promise<ReportTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (payload.kind !== 'report') return null;
    if (!['project', 'feature', 'case'].includes(String(payload.scope))) return null;
    const projectId = Number(payload.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) return null;
    return {
      kind: 'report',
      scope: payload.scope as ReportTokenPayload['scope'],
      projectId,
      feature: typeof payload.feature === 'string' ? payload.feature : undefined,
      caseId: typeof payload.caseId === 'number' ? payload.caseId : undefined,
      createdBy: typeof payload.createdBy === 'string' ? payload.createdBy : '未知',
    };
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<UserPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;
  const user = await verifyToken(token);
  if (!user) return null;
  return user;
}

export function isManagerUser(username: string): boolean {
  return MANAGER_USERNAMES.includes(username as typeof MANAGER_USERNAMES[number]);
}
