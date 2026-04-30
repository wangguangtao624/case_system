import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const db = getDb();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'storage_path'").get() as { value: string } | undefined;

    return NextResponse.json({ storagePath: setting?.value || '' });
  } catch (error) {
    console.error('Get settings error:', error);
    return NextResponse.json({ error: '获取设置失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可修改设置' }, { status: 403 });
    }

    const { storagePath } = await request.json();
    if (!storagePath || !storagePath.trim()) {
      return NextResponse.json({ error: '请输入存储路径' }, { status: 400 });
    }

    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('storage_path', ?)").run(storagePath.trim());

    // Create directory if it doesn't exist
    const fs = await import('fs');
    if (!fs.existsSync(storagePath.trim())) {
      fs.mkdirSync(storagePath.trim(), { recursive: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update settings error:', error);
    return NextResponse.json({ error: '更新设置失败' }, { status: 500 });
  }
}
