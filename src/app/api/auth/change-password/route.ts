import { NextRequest, NextResponse } from 'next/server';
import { getDb, verifyPassword, hashPassword } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { oldPassword, newPassword } = await request.json();
    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: '请输入原密码和新密码' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: '新密码长度不能少于6位' }, { status: 400 });
    }

    const db = getDb();
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(user.id) as { password: string };

    if (!verifyPassword(oldPassword, row.password)) {
      return NextResponse.json({ error: '原密码错误' }, { status: 400 });
    }

    const hashed = hashPassword(newPassword);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: '修改密码失败' }, { status: 500 });
  }
}
