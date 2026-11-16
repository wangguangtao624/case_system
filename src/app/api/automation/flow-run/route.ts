import {isLocalAutomationRequest} from '@/lib/local-automation-request';
import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {validateLocalGraph} from '@/lib/automation-validate';
import {spawn} from 'child_process';
import {randomUUID} from 'crypto';
import fs from 'fs';import os from 'os';import path from 'path';
export const runtime='nodejs';
const root=path.resolve(process.cwd(),'../..'),runs=path.join(root,'集成方案','画布平台运行'),lock=path.join(root,'集成方案','AP平台运行','device.lock');
async function access(req:NextRequest,id:number){if(!isLocalAutomationRequest(req))return false;const user=await getCurrentUser();return user?.role==='admin'&&!!getDb().prepare('SELECT id FROM cases WHERE id=?').get(id)}
export async function POST(req:NextRequest){
 const body=await req.json(),id=Number(body.caseId),repeat=Number(body.repeat??1);if(!Number.isSafeInteger(id)||!await access(req,id))return NextResponse.json({error:'无权限或用例不存在'},{status:403});
 if(!Number.isInteger(repeat)||repeat<1||repeat>10000)return NextResponse.json({error:'重复次数须为 1 到 10000'},{status:400});
 const db=getDb();db.exec('CREATE TABLE IF NOT EXISTS automation_flows (case_id INTEGER PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE, graph TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)');
 const flow=db.prepare('SELECT graph,revision FROM automation_flows WHERE case_id=?').get(id) as {graph:string;revision:number}|undefined;
 if(!flow||flow.revision!==body.revision)return NextResponse.json({error:'请等待画布保存，或重新打开用例'}, {status:409});
 const parsed=JSON.parse(flow.graph);const issue=validateLocalGraph(parsed);if(issue)return NextResponse.json({error:issue},{status:400});
 const python=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe'),script=path.join(root,'web_repeat_runner.py');if(!fs.existsSync(python)||!fs.existsSync(script))return NextResponse.json({error:'执行器不可用'},{status:503});
 fs.mkdirSync(runs,{recursive:true});fs.mkdirSync(path.dirname(lock),{recursive:true});try{const fd=fs.openSync(lock,'wx');fs.closeSync(fd)}catch{return NextResponse.json({error:'设备正在使用，或上次异常退出后运行锁仍存在'},{status:409})}
 const runId=randomUUID(),snapshot=path.join(runs,runId+'.case.json'),meta=path.join(runs,runId+'.json'),dir=path.join(runs,runId),startedAt=new Date().toISOString();
 try{fs.writeFileSync(snapshot,flow.graph,'utf8');fs.writeFileSync(meta,JSON.stringify({runId,caseId:id,revision:flow.revision,startedAt,state:'running'}),'utf8');const child=spawn(python,[script,snapshot,dir,String(repeat)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',(d:Buffer)=>{output=(output+d.toString('utf8')).slice(-30000)});child.stderr.on('data',(d:Buffer)=>{output=(output+d.toString('utf8')).slice(-30000)});let ended=false;const finish=(exitCode:number|null,error?:string)=>{if(ended)return;ended=true;try{fs.writeFileSync(meta,JSON.stringify({runId,caseId:id,revision:flow.revision,startedAt,state:'finished',exitCode,error,output}),'utf8')}finally{try{fs.unlinkSync(lock)}catch{}}};child.on('error',e=>finish(null,e.message));child.on('close',c=>finish(c));return NextResponse.json({runId})}catch(e){try{fs.unlinkSync(lock)}catch{};return NextResponse.json({error:String(e)},{status:500})}
}
export async function GET(req:NextRequest){
 const id=Number(req.nextUrl.searchParams.get('caseId')),runId=req.nextUrl.searchParams.get('run')||'';if(!Number.isSafeInteger(id)||!await access(req,id))return NextResponse.json({error:'无权限或用例不存在'},{status:403});
 if(!runId){if(!fs.existsSync(runs))return NextResponse.json({runs:[]});const list=fs.readdirSync(runs).filter(n=>/^[0-9a-f-]{36}\.json$/.test(n)).flatMap(n=>{try{const m=JSON.parse(fs.readFileSync(path.join(runs,n),'utf8'));return m.caseId===id?[{runId:m.runId,startedAt:m.startedAt,state:m.state}]:[]}catch{return []}}).sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt)));return NextResponse.json({runs:list})}
 if(!/^[0-9a-f-]{36}$/.test(runId))return NextResponse.json({error:'参数错误'},{status:400});const meta=path.join(runs,runId+'.json');if(!fs.existsSync(meta))return NextResponse.json({error:'记录不存在'},{status:404});const m=JSON.parse(fs.readFileSync(meta,'utf8'));if(m.caseId!==id)return NextResponse.json({error:'记录不属于此用例'},{status:403});const dir=path.join(runs,runId),rp=path.join(dir,'results.json');let result=null;
 try {if(fs.existsSync(rp))result=JSON.parse(fs.readFileSync(rp,'utf8'));else if(m.state==='running'){
  const progress=path.join(dir,'progress.json');result=fs.existsSync(progress)?JSON.parse(fs.readFileSync(progress,'utf8')):{state:'运行中',rounds:[]};
  const index=(result.rounds?.length||0)+1;const current=path.join(dir,`第${String(index).padStart(3,'0')}轮`,'progress.json');
  if(fs.existsSync(current)){const currentResult=JSON.parse(fs.readFileSync(current,'utf8'));result.rounds=[...(result.rounds||[]),{index,result:currentResult}];}
 }}catch {result=null}
 if(req.nextUrl.searchParams.get('image')==='1'){const round=Number(req.nextUrl.searchParams.get('round'));const preview=round&&result?.rounds?result.rounds.find((r:{index:number})=>r.index===round)?.result?.preview:result?.preview;if(!preview)return NextResponse.json({error:'无图片'},{status:404});const file=path.resolve(preview);if(!file.startsWith(dir+path.sep)||!file.endsWith('.png')||!fs.existsSync(file))return NextResponse.json({error:'图片不可用'},{status:404});return new Response(fs.readFileSync(file),{headers:{'Content-Type':'image/png','Cache-Control':'no-store'}})}
 const snapshotPath=path.join(runs,runId+'.case.json');let snapshot=null;try{if(fs.existsSync(snapshotPath))snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'))}catch{}
 return NextResponse.json({runId,state:m.state,error:m.error,exitCode:m.exitCode,result,snapshot});
}
