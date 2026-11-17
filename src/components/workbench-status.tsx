'use client';
import {useCallback,useEffect,useState} from 'react';
interface Bench {id:string;name:string;enabled:boolean;online:boolean;lastSeen:number|null;devices:Array<{name:string;kind:string}>}
export default function WorkbenchStatus(){
 const [rows,setRows]=useState<Bench[]>([]);const [manager,setManager]=useState(false);const [name,setName]=useState('');const [token,setToken]=useState('');const [error,setError]=useState('');
 const refresh=useCallback(async()=>{try{const r=await fetch('/api/workbenches',{cache:'no-store'});if(!r.ok)throw Error('无法读取测试台');const d=await r.json();setRows(d.workbenches);setManager(d.isManager)}catch(e){setError(e instanceof Error?e.message:'读取失败')}},[]);
 useEffect(()=>{void refresh();const timer=setInterval(refresh,10000);return()=>clearInterval(timer)},[refresh]);
 const register=async()=>{setError('');try{const r=await fetch('/api/workbenches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});const d=await r.json();if(!r.ok)throw Error(d.error);setToken(d.token);setName('');void refresh()}catch(e){setError(e instanceof Error?e.message:'注册失败')}};
 return <details className="border rounded bg-white p-3 mt-3 text-xs"><summary className="cursor-pointer font-semibold">设备工作台状态</summary><p className="mt-2 text-slate-500">当前阶段仅上报在线状态和串口；设备识别与远程执行尚未接入。</p>
 {rows.filter(x=>x.enabled).map(b=><div key={b.id} className="border rounded p-2 mt-2"><b>{b.name}</b> · {b.online?'在线':'离线'}{b.lastSeen&&<span> · 最近心跳 {new Date(b.lastSeen).toLocaleString()}</span>}<p>{b.devices.length?b.devices.map(d=>d.name).join('、'):'未检测到串口（度信设备状态尚未识别）'}</p>{manager&&<button className="text-red-600 mt-1" onClick={async()=>{await fetch('/api/workbenches?id='+encodeURIComponent(b.id),{method:'DELETE'});void refresh()}}>停用此工作台</button>}</div>)}
 {manager&&<div className="mt-3 flex gap-2"><input className="border rounded px-2 py-1" value={name} onChange={e=>setName(e.target.value)} placeholder="工作台名称"/><button className="border rounded px-2" onClick={register}>注册工作台</button></div>}
 {token&&<div className="mt-2"><p>配置令牌仅显示一次，请在受信任的设备电脑上保存：</p><textarea readOnly className="border rounded w-full p-2" value={JSON.stringify({server:typeof window==='undefined'?'':window.location.origin,token},null,2)} /><button className="text-blue-600" onClick={()=>setToken('')}>已保存，关闭</button></div>}{error&&<p className="text-red-600">{error}</p>}
 </details>;
}
