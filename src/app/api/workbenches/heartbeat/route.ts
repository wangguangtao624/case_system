import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { authenticateWorkbench } from '@/lib/workbenches';
export const runtime = 'nodejs';
export async function POST(req:NextRequest) {
 const db=getDb();const agent=authenticateWorkbench(db,req.headers.get('authorization'));
 if(!agent)return NextResponse.json({error:'测试台身份无效或已停用'},{status:401});
 const body=await req.json();
 if(!Array.isArray(body.devices)||body.devices.length>100||body.devices.some((d:unknown)=>!d||typeof d!=='object'||typeof (d as Record<string,unknown>).name!=='string'||typeof (d as Record<string,unknown>).kind!=='string'||String((d as Record<string,unknown>).name).length>200))return NextResponse.json({error:'设备列表无效'},{status:400});
 const devices=body.devices.map((d:{name:string;kind:string})=>({name:d.name,kind:d.kind}));
 db.prepare('UPDATE automation_workbenches SET last_seen=?,inventory=? WHERE id=?').run(Date.now(),JSON.stringify(devices),agent.id);
 return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}
