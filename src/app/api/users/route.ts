import { NextRequest, NextResponse } from 'next/server';
import { getDb, hashPassword } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

const MANAGER_USERNAMES = ['admin', '张宇慧', '刘济聪'];

function isManagerOrAdmin(user: { username: string; role: string }): boolean {
  return user.role === 'admin' || MANAGER_USERNAMES.includes(user.username);
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || !isManagerOrAdmin(user)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }
    const db = getDb();
    const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
    return NextResponse.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json({ error: '获取用户列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !isManagerOrAdmin(user)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: '密码长度不能少于6位' }, { status: 400 });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 400 });
    }

    const hashed = hashPassword(password);
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hashed, 'user');

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: '创建用户失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !isManagerOrAdmin(user)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: '缺少用户ID' }, { status: 400 });
    }

    if (userId === user.id) {
      return NextResponse.json({ error: '不可删除自身管理员账号' }, { status: 400 });
    }

    const db = getDb();

    // Check target is not admin
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
    if (!target) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }
    if (target.role === 'admin') {
      return NextResponse.json({ error: '不可删除管理员账号' }, { status: 400 });
    }

    // Delete user and all related data (cascade will handle projects, modules, cases, files)
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json({ error: '删除用户失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !isManagerOrAdmin(user)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: '缺少用户ID' }, { status: 400 });
    }

    const db = getDb();
    const defaultPassword = hashPassword('111111');
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(defaultPassword, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: '重置密码失败' }, { status: 500 });
  }
}
