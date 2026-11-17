import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
export const runtime='nodejs';
async function access(req:NextRequest,id:number){

 const user=await getCurrentUser();if(user?.role!=='admin')return false;
 return !!getDb().prepare('SELECT id FROM cases WHERE id=?').get(id);
}
function table(){const db=getDb();db.exec('CREATE TABLE IF NOT EXISTS automation_flows (case_id INTEGER PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE, graph TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)');return db}
export async function GET(req:NextRequest){
 const id=Number(req.nextUrl.searchParams.get('caseId'));if(!Number.isSafeInteger(id)||!await access(req,id))return NextResponse.json({error:'无权限或用例不存在'},{status:403});
 const row=table().prepare('SELECT graph,revision,updated_at FROM automation_flows WHERE case_id=?').get(id) as {graph:string;revision:number;updated_at:string}|undefined;
 return NextResponse.json(row?{graph:JSON.parse(row.graph),revision:row.revision,updatedAt:row.updated_at}:{graph:{version:2,nodes:[],edges:[]},revision:0});
}
export async function PUT(req:NextRequest){
 const body=await req.json();const id=Number(body.caseId);if(!Number.isSafeInteger(id)||!await access(req,id))return NextResponse.json({error:'无权限或用例不存在'},{status:403});
 const origin=req.headers.get('origin');if(origin && origin!==req.nextUrl.origin && origin!==`${req.nextUrl.protocol}//${req.headers.get('host')}`)return NextResponse.json({error:'请求来源无效'},{status:403});
 const project=getDb().prepare('SELECT p.is_archived, p.publish_status FROM cases c JOIN modules m ON m.id=c.module_id JOIN projects p ON p.id=m.project_id WHERE c.id=?').get(id) as {is_archived:number;publish_status:string};
 if(project.is_archived || project.publish_status==='archived')return NextResponse.json({error:'归档项目的画布为只读'}, {status:403});
 const g=body.graph,revision=body.revision;const allowed=new Set(['wait','relay_on','relay_off','power_on','power_off','i2c_read','i2c_write','i2c_compare','capture','metrics','firmware','firmware_backup','binary_patch']);
 if(!g||g.version!==2||!Array.isArray(g.nodes)||!Array.isArray(g.edges)||g.nodes.length>100||g.edges.length>100||!Number.isSafeInteger(revision)||revision<0||g.nodes.some((n:Record<string,unknown>)=>!n||typeof n.id!=='string'||!allowed.has(String(n.type))||typeof n.x!=='number'||typeof n.y!=='number'||!n.params||typeof n.params!=='object')||JSON.stringify(g).length>200000)return NextResponse.json({error:'画布数据无效或包含暂不支持的节点'},{status:400});
 const db=table();const save=db.transaction(()=>{const existing=db.prepare('SELECT revision FROM automation_flows WHERE case_id=?').get(id) as {revision:number}|undefined;if((existing?.revision||0)!==revision)return null;const next=revision+1;db.prepare('INSERT INTO automation_flows(case_id,graph,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET graph=excluded.graph,revision=excluded.revision,updated_at=excluded.updated_at').run(id,JSON.stringify(g),next,new Date().toISOString());return next;});
 const next=save();if(next===null)return NextResponse.json({error:'流程已在其他页面更改，请刷新后重试'},{status:409});return NextResponse.json({revision:next});
}
