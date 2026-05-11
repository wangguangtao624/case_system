import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

const DEFAULT_PREFERENCES = {
  startDate: '',
  periodMonths: 6,
  granularity: 'week',
  sortByStartDate: false,
  showOnlyIncompleteModules: false,
  selectedProjectId: null as number | null,
  priorityMode: 'all' as 'all' | 'high',
};

function getPreferenceKey(userId: number) {
  return `kanban_preferences_${userId}`;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(getPreferenceKey(user.id)) as { value: string } | undefined;
    if (!row?.value) {
      return NextResponse.json({ preferences: DEFAULT_PREFERENCES });
    }

    const parsed = JSON.parse(row.value) as {
      startDate?: string;
      periodMonths?: number;
      granularity?: 'day' | 'week' | 'month';
      sortByStartDate?: boolean;
      showOnlyIncompleteModules?: boolean;
      selectedProjectId?: number | null;
      priorityMode?: 'all' | 'high';
    };

    return NextResponse.json({
      preferences: {
        startDate: typeof parsed.startDate === 'string' ? parsed.startDate : DEFAULT_PREFERENCES.startDate,
        periodMonths: parsed.periodMonths === 3 || parsed.periodMonths === 6 || parsed.periodMonths === 9 || parsed.periodMonths === 12
          ? parsed.periodMonths
          : DEFAULT_PREFERENCES.periodMonths,
        granularity: parsed.granularity === 'month'
          ? 'month'
          : DEFAULT_PREFERENCES.granularity,
        sortByStartDate: typeof parsed.sortByStartDate === 'boolean'
          ? parsed.sortByStartDate
          : DEFAULT_PREFERENCES.sortByStartDate,
        showOnlyIncompleteModules: typeof parsed.showOnlyIncompleteModules === 'boolean'
          ? parsed.showOnlyIncompleteModules
          : DEFAULT_PREFERENCES.showOnlyIncompleteModules,
        selectedProjectId: typeof parsed.selectedProjectId === 'number'
          ? parsed.selectedProjectId
          : DEFAULT_PREFERENCES.selectedProjectId,
        priorityMode: parsed.priorityMode === 'high'
          ? 'high'
          : DEFAULT_PREFERENCES.priorityMode,
      },
    });
  } catch (error) {
    console.error('Get kanban preferences error:', error);
    return NextResponse.json({ error: '获取看板偏好失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const body = await request.json() as {
      startDate?: string;
      periodMonths?: number;
      granularity?: 'day' | 'week' | 'month';
      sortByStartDate?: boolean;
      showOnlyIncompleteModules?: boolean;
      selectedProjectId?: number | null;
      priorityMode?: 'all' | 'high';
    };

    const preferences = {
      startDate: typeof body.startDate === 'string' ? body.startDate : DEFAULT_PREFERENCES.startDate,
      periodMonths: body.periodMonths === 3 || body.periodMonths === 6 || body.periodMonths === 9 || body.periodMonths === 12
        ? body.periodMonths
        : DEFAULT_PREFERENCES.periodMonths,
      granularity: body.granularity === 'month'
        ? 'month'
        : DEFAULT_PREFERENCES.granularity,
      sortByStartDate: typeof body.sortByStartDate === 'boolean'
        ? body.sortByStartDate
        : DEFAULT_PREFERENCES.sortByStartDate,
      showOnlyIncompleteModules: typeof body.showOnlyIncompleteModules === 'boolean'
        ? body.showOnlyIncompleteModules
        : DEFAULT_PREFERENCES.showOnlyIncompleteModules,
      selectedProjectId: typeof body.selectedProjectId === 'number'
        ? body.selectedProjectId
        : DEFAULT_PREFERENCES.selectedProjectId,
      priorityMode: body.priorityMode === 'high'
        ? 'high'
        : DEFAULT_PREFERENCES.priorityMode,
    };

    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      getPreferenceKey(user.id),
      JSON.stringify(preferences),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update kanban preferences error:', error);
    return NextResponse.json({ error: '保存看板偏好失败' }, { status: 500 });
  }
}
