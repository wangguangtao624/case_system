import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getAutomationRun, startAutomationRun, type AutomationMode } from '@/lib/automation';

const MANAGERS = ['admin', '张宇慧', '刘济聪'];

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const form = await request.formData();
    const ini = form.get('ini') as File | null;
    const bin = form.get('bin') as File | null;
    const mode = String(form.get('mode') || 'single') as AutomationMode;
    const caseIds = JSON.parse(String(form.get('caseIds') || '[]')) as number[];
    if (!ini || !ini.name.toLowerCase().endsWith('.ini')) return NextResponse.json({ error: '请选择 INI 文件' }, { status: 400 });
    if (!bin || !bin.name.toLowerCase().endsWith('.bin')) return NextResponse.json({ error: '请选择 bin 文件' }, { status: 400 });
    if (!['single', 'selected', 'project'].includes(mode)) return NextResponse.json({ error: '运行模式错误' }, { status: 400 });
    const runId = startAutomationRun({
      userId: user.id,
      mode,
      caseIds,
      ini: Buffer.from(await ini.arrayBuffer()),
      iniName: ini.name,
      bin: Buffer.from(await bin.arrayBuffer()),
      binName: bin.name,
    });
    return NextResponse.json({ success: true, runId }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '启动自动化失败' }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const runId = new URL(request.url).searchParams.get('id');
  if (!runId) return NextResponse.json({ error: '缺少运行ID' }, { status: 400 });
  const run = getAutomationRun(runId, user.id, MANAGERS.includes(user.username));
  if (!run) return NextResponse.json({ error: '运行记录不存在' }, { status: 404 });
  return NextResponse.json({ run });
}
