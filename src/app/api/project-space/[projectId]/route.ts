import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

interface ProjectSpaceFileRow {
  id: number;
  project_id: number;
  space_type: 'public' | 'personal';
  owner_user_id: number | null;
  owner_username: string;
  filename: string;
  original_name: string;
  file_size: number;
  file_type: string;
  created_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const { projectId } = await params;
    const resolvedProjectId = Number(projectId);
    if (!resolvedProjectId) {
      return NextResponse.json({ error: '项目参数无效' }, { status: 400 });
    }

    const db = getDb();
    const project = db.prepare(`
      SELECT id, name, is_archived
      FROM projects
      WHERE id = ?
    `).get(resolvedProjectId) as { id: number; name: string; is_archived: number } | undefined;

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const rows = db.prepare(`
      SELECT id, project_id, space_type, owner_user_id, owner_username, filename, original_name, file_size, file_type, created_at
      FROM project_space_files
      WHERE project_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
    `).all(resolvedProjectId) as ProjectSpaceFileRow[];

    const publicFiles = rows.filter(row => row.space_type === 'public');
    const personalSpacesMap = new Map<string, { userId: number | null; username: string; files: ProjectSpaceFileRow[] }>();

    for (const row of rows) {
      if (row.space_type !== 'personal') continue;
      const key = row.owner_username || `user-${row.owner_user_id ?? 'unknown'}`;
      if (!personalSpacesMap.has(key)) {
        personalSpacesMap.set(key, {
          userId: row.owner_user_id,
          username: row.owner_username || '未知用户',
          files: [],
        });
      }
      personalSpacesMap.get(key)!.files.push(row);
    }

    const personalSpaces = Array.from(personalSpacesMap.values()).sort((a, b) => {
      const latestA = a.files[0]?.created_at || '';
      const latestB = b.files[0]?.created_at || '';
      if (latestA !== latestB) return latestB.localeCompare(latestA);
      return a.username.localeCompare(b.username, 'zh-CN');
    });

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        isArchived: project.is_archived === 1,
      },
      publicFiles,
      personalSpaces,
    });
  } catch (error) {
    console.error('Get project space error:', error);
    return NextResponse.json({ error: '获取项目空间失败' }, { status: 500 });
  }
}
