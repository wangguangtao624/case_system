import { NextRequest, NextResponse } from 'next/server';
import { getDb, verifyPassword } from '@/lib/db';
import { createToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT id, username, password, role FROM users WHERE username = ?').get(username) as {
      id: number;
      username: string;
      password: string;
      role: string;
    } | undefined;

    if (!user || !verifyPassword(password, user.password)) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const token = await createToken({
      id: user.id,
      username: user.username,
      role: user.role as 'admin' | 'user',
    });

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, username: user.username, role: user.role },
    });

    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}
