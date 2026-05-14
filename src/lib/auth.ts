import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (secret) return new TextEncoder().encode(secret);

  const secretPath = path.join(process.env.COZE_WORKSPACE_PATH || process.cwd(), 'data', '.jwt_secret');
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
