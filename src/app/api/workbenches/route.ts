import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isManagerUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { initWorkbenches, hashWorkbenchToken } from '@/lib/workbenches';
import { randomBytes, randomUUID } from 'crypto';
export const runtime = 'nodejs';
export async function GET() {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({error:'未登录'},{status:401});
  const db=getDb(); initWorkbenches(db);
  const rows=db.prepare('SELECT id,name,enabled,last_seen,inventory FROM automation_workbenches ORDER BY name,id').all() as Array<{id:string;name:string;enabled:number;last_seen:number|null;inventory:string}>;
  return NextResponse.json({workbenches:rows.map(row=>({id:row.id,name:row.name,enabled:!!row.enabled,lastSeen:row.last_seen,online:!!row.enabled&&!!row.last_seen&&Date.now()-row.last_seen<30000,devices:JSON.parse(row.inventory)})),isManager:isManagerUser(user.username)});
}
export async function POST(req:NextRequest) {
  const user=await getCurrentUser(); if (!user || !isManagerUser(user.username)) return NextResponse.json({error:'仅管理员可注册测试台'},{status:403});
  const origin=req.headers.get('origin'); if(origin && origin!==`${req.nextUrl.protocol}//${req.headers.get('host')}`)return NextResponse.json({error:'请求来源无效'},{status:403});
  const body=await req.json(); const name=typeof body.name==='string'?body.name.trim():''; if(!name||name.length>80)return NextResponse.json({error:'请输入不超过 80 字的测试台名称'},{status:400});
  const id=randomUUID(),token=randomBytes(32).toString('base64url'); const db=getDb();initWorkbenches(db);
  db.prepare('INSERT INTO automation_workbenches(id,name,token_hash) VALUES(?,?,?)').run(id,name,hashWorkbenchToken(token));
  return NextResponse.json({id,token,name},{headers:{'Cache-Control':'no-store'}});
}
export async function DELETE(req:NextRequest) {
  const user=await getCurrentUser(); if (!user || !isManagerUser(user.username))return NextResponse.json({error:'无权限'},{status:403});
  const origin=req.headers.get('origin'); if(origin && origin!==`${req.nextUrl.protocol}//${req.headers.get('host')}`)return NextResponse.json({error:'请求来源无效'},{status:403});
  const id=req.nextUrl.searchParams.get('id');const db=getDb();initWorkbenches(db);db.prepare('UPDATE automation_workbenches SET enabled=0 WHERE id=?').run(id);return NextResponse.json({success:true});
}
