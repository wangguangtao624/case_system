import {isLocalAutomationRequest} from '@/lib/local-automation-request';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const runtime = 'nodejs';
const codes = new Set(['FW_AP_Interaction_002', 'FW_AP_Interaction_003', 'FW_AP_Interaction_011']);
const root = path.resolve(process.cwd(), '../..');
const runs = path.join(root, '集成方案', 'AP平台运行');
const lock = path.join(runs, 'device.lock');

async function auth(req: NextRequest) {
  if (!isLocalAutomationRequest(req)) return false;
  const user = await getCurrentUser(); return user?.role === 'admin';
}
function caseCode(id: number): string | null {
  const row = getDb().prepare(`SELECT c.case_no FROM cases c JOIN modules m ON m.id=c.module_id JOIN projects p ON p.id=m.project_id WHERE c.id=? AND p.name=?`).get(id, 'MAT130AV300 自动化参考（来源 MAT330AV200，待校准）') as {case_no:string}|undefined;
  return row && codes.has(row.case_no) ? row.case_no : null;
}
export async function POST(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({error:'仅本机开发环境的管理员可运行'}, {status:403});
  const body = await req.json(); const id = Number(body.caseId); const code = caseCode(id);
  if (!Number.isSafeInteger(id) || !code) return NextResponse.json({error:'此用例尚未接入实机试点'}, {status:400});
  const python = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
  const pilot = path.join(root, 'ap_pilot.py');
  if (!fs.existsSync(python) || !fs.existsSync(pilot)) return NextResponse.json({error:'本机执行器不可用'}, {status:503});
  fs.mkdirSync(runs, {recursive:true});
  let descriptor: number;
  try { descriptor = fs.openSync(lock, 'wx'); fs.closeSync(descriptor); }
  catch { return NextResponse.json({error:'设备正忙或上次异常退出，请检查设备和运行锁'}, {status:409}); }
  const runId = randomUUID(); const target = path.join(runs,runId); const meta = path.join(runs,runId+'.json'); const startedAt=new Date().toISOString();
  fs.writeFileSync(meta, JSON.stringify({runId,caseId:id,caseNo:code,startedAt,state:'running'}), 'utf8');
  const child=spawn(python,[pilot,target,code],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']}); let diag='';
  child.stdout.on('data',(x:Buffer)=>{diag=(diag+x.toString('utf8')).slice(-30000)}); child.stderr.on('data',(x:Buffer)=>{diag=(diag+x.toString('utf8')).slice(-30000)});
  let done=false;
  const finish=(exitCode:number|null,error?:string)=>{if(done)return;done=true;try {fs.writeFileSync(meta,JSON.stringify({runId,caseId:id,caseNo:code,startedAt,state:'finished',exitCode,error,diagnostics:diag}), 'utf8')} finally {try{fs.unlinkSync(lock)}catch{}}};
  child.on('error',e=>finish(null,e.message));child.on('close',code=>finish(code));
  return NextResponse.json({runId,state:'running'});
}
export async function GET(req: NextRequest) {
  if (!await auth(req)) return NextResponse.json({error:'仅本机开发环境的管理员可查看'}, {status:403});
  const runId=req.nextUrl.searchParams.get('run')||'';const id=Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isSafeInteger(id)||!caseCode(id)) return NextResponse.json({error:'参数错误'}, {status:400});
  if (!runId) {
    if (!fs.existsSync(runs)) return NextResponse.json({runs:[]});
    const history=fs.readdirSync(runs).filter(name=>/^[0-9a-f-]{36}\.json$/.test(name)).flatMap(name=>{
      try { const m=JSON.parse(fs.readFileSync(path.join(runs,name),'utf8'));return m.caseId===id?[{runId:m.runId,startedAt:m.startedAt,state:m.state}]:[]; } catch {return []}
    }).sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt)));
    return NextResponse.json({runs:history});
  }
  if (!/^[0-9a-f-]{36}$/.test(runId)) return NextResponse.json({error:'参数错误'}, {status:400});
  const meta=path.join(runs,runId+'.json');if (!fs.existsSync(meta)) return NextResponse.json({error:'记录不存在'}, {status:404});
  const data=JSON.parse(fs.readFileSync(meta,'utf8'));if(data.caseId!==id)return NextResponse.json({error:'记录不属于此用例'}, {status:403});
  const dir=path.join(runs,runId), resultPath=path.join(dir,'results.json');
  const result=fs.existsSync(resultPath)?JSON.parse(fs.readFileSync(resultPath,'utf8')):null;
  if(req.nextUrl.searchParams.get('image')==='1') {
    if(!result?.preview)return NextResponse.json({error:'无图片'}, {status:404});
    const file=path.resolve(result.preview);if(path.dirname(file)!==dir||!file.endsWith('.png')||!fs.existsSync(file))return NextResponse.json({error:'图片不可用'}, {status:404});
    return new Response(fs.readFileSync(file),{headers:{'Content-Type':'image/png','Cache-Control':'no-store'}});
  }
  return NextResponse.json({runId,state:data.state,error:data.error,exitCode:data.exitCode,result});
}
