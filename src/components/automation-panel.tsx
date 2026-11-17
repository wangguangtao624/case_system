'use client';
import { useEffect, useState } from 'react';
import FlowEditor from './flow-editor';
import BatchPanel from './batch-panel';
import WorkbenchStatus from './workbench-status';

type Props = { caseNo: string | null; caseId: number; moduleId: number };
export default function AutomationPanel({ caseNo, caseId, moduleId }: Props) {
  const [message, setMessage] = useState('');
  const [editing,setEditing]=useState(false);
  const supported = caseNo === 'FW_Boot_001';
  const pilot = ['FW_AP_Interaction_002','FW_AP_Interaction_003','FW_AP_Interaction_011'].includes(caseNo || '');
  const [running,setRunning]=useState(false);const [runId,setRunId]=useState('');const [result,setResult]=useState<{error?:string;preview?:string;cleanup?:string[];cases?:Array<{case_no:string;register:string;values:number[];status:string;error?:string}>}|null>(null);
  const [history,setHistory]=useState<Array<{runId:string;startedAt:string;state:string}>>([]);
  async function loadHistory(id:number) {const response=await fetch(`/api/automation/local-pilot?caseId=${id}`,{cache:'no-store'});if(response.ok){const data=await response.json();setHistory(data.runs||[])}}
  async function showRun(id:string){if(!id){setRunId('');setResult(null);return}setRunId(id);const response=await fetch(`/api/automation/local-pilot?run=${encodeURIComponent(id)}&caseId=${caseId}`,{cache:'no-store'});const data=await response.json();if(response.ok){setResult(data.result);setMessage(data.result?.error?'设备执行失败：'+data.result.error:data.state==='running'?'执行中':'历史试点结果 · 参考标准待核实')}else setMessage(data.error||'无法读取记录')}
  useEffect(()=>{setRunning(false);setRunId('');setResult(null);setMessage('');setHistory([]);if(pilot)void loadHistory(caseId)},[caseId,pilot]);
  async function runPilot(){
    setRunning(true);setResult(null);setMessage('正在连接本机设备并执行只读试点，完成后会关闭设备和继电器。');
    try{
      const response=await fetch('/api/automation/local-pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId})});const job=await response.json();if(!response.ok)throw new Error(job.error||'启动失败');setRunId(job.runId);
      for(let i=0;i<180;i++){
        await new Promise(resolve=>setTimeout(resolve,1000));const r=await fetch(`/api/automation/local-pilot?run=${encodeURIComponent(job.runId)}&caseId=${caseId}`,{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'读取失败');
        if(data.state==='finished'){setResult(data.result);void loadHistory(caseId);setMessage(data.error || (data.result?.error ? '设备执行失败：'+data.result.error : data.result ? '实机读取完成；结果按参考用例判断，需核对目标型号及字节格式。' : '执行器未产生结果，请检查本机日志。'));return}
      }
      setMessage('等待超时；任务可能仍在执行，请勿重复启动。');
    }catch(e){setMessage(e instanceof Error?e.message:'启动失败')}finally{setRunning(false)}
  }
  function downloadDraft() {
    const specs: Array<[string, Record<string, unknown>]> = [
      ['relay_on', {port: 'COM3', channel: 0}], ['wait', {seconds: 1}],
      ['power_on', {ini: '${APPDIR}/assets/device.ini'}], ['capture', {output: '${RUNDIR}/图片/capture'}],
      ...['0x0000', '0x00d0', '0x00d4', '0x00d8', '0x00dc', '0x00cc', '0x0958'].map((register): [string, Record<string, unknown>] => ['i2c_read', {slave: '0x40', register, address_bits: 16, data_bits: 32, expected: '', mask: '0xffffffff'}]),
      ['wait', {seconds: 1}], ['i2c_read', {slave: '0x40', register: '0x00cc', address_bits: 16, data_bits: 32, expected: '', mask: '0xffffffff'}],
      ['power_off', {}], ['relay_off', {port: 'COM3', channel: 0}],
    ];
    const nodes = specs.map(([type, params], i) => ({id: crypto.randomUUID().replaceAll('-', ''), type, x: (i % 4) * 220, y: Math.floor(i / 4) * 155, params}));
    const edges = nodes.slice(1).map((node, i) => ({from: nodes[i].id, to: node.id}));
    const blob = new Blob([JSON.stringify({version: 2, repeat_count: 1, nodes, edges}, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `FW_Boot_001-${caseId}-待校准.case.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('草稿已下载。请放入设备画布项目目录并核实地址、位宽、寄存器、INI 和版本；计数器两次读取不会自动比较。');
  }
  return <section className="rounded-lg border p-4 mb-4" style={{borderColor:'#BFDBFE',background:'#F5F9FF'}}>
    <div className="flex items-center gap-3 flex-wrap"><strong className="text-sm" style={{color:'#1E3A5F'}}>自动化测试</strong><button type="button" className="border rounded px-3 py-1 text-xs bg-white" onClick={()=>setEditing(!editing)}>{editing?'收起画布':'编辑画布'}</button><span className="text-xs" style={{color:'#A15C00'}}>{pilot ? '本机实机只读试点' : supported ? '启动检查草稿 · 待校准' : '待配置自动化流程'}</span>
      {pilot && <button type="button" disabled={running} onClick={runPilot} className="px-3 py-1.5 rounded text-xs" style={{background:'#2563EB',color:'white',opacity:running?.6:1}}>{running?'执行中…':'本机实机读取'}</button>}
      {supported && <button type="button" onClick={downloadDraft} className="px-3 py-1.5 rounded text-xs" style={{background:'#2563EB',color:'white'}}>下载画布草稿</button>}
    </div>
    <p className="text-xs mt-2" style={{color:'#64748B'}}>画布可由管理员编辑并保存。设备执行仍仅支持连接设备的本机试点；当前服务器尚未接入跨电脑设备代理，参考型号的预期值需复核。</p>
    {pilot && history.length>0 && <label className="text-xs mt-2 block">执行记录 <select value={runId} onChange={e=>void showRun(e.target.value)} className="ml-2 border rounded p-1"><option value="">选择一次执行</option>{history.map(item=><option key={item.runId} value={item.runId}>{new Date(item.startedAt).toLocaleString()} · {item.state==='running'?'运行中':'已结束'}</option>)}</select><button type="button" className="ml-2 px-2 py-1 border rounded bg-white" disabled={!runId} onClick={()=>void showRun(runId)}>查看记录</button></label>}
    {result?.cases?.map(item=><div key={item.case_no} className="text-xs mt-2" style={{color:'#1E3A5F'}}>{item.register}：{item.values.map(v=>'0x'+v.toString(16).padStart(8,'0')).join(' → ')} · {item.status}{item.error ? ' · '+item.error : ''}</div>)}
    {result?.cleanup && <p className="text-xs mt-2" style={{color:result.cleanup.some(x=>x.includes('失败'))?'#b91c1c':'#64748B'}}>结束处理：{result.cleanup.join(' · ')}</p>}
    {result?.preview && <a href={`/api/automation/local-pilot?run=${encodeURIComponent(runId)}&caseId=${caseId}&image=1`} target="_blank" rel="noopener noreferrer" title="点击打开原图"><img alt="本次设备抓图，点击打开原图" className="mt-3 rounded cursor-zoom-in" style={{maxWidth:'360px',width:'100%'}} src={`/api/automation/local-pilot?run=${encodeURIComponent(runId)}&caseId=${caseId}&image=1`}/></a>}
    <WorkbenchStatus/>
    <BatchPanel key={moduleId} moduleId={moduleId}/>
    {editing && <FlowEditor key={caseId} caseId={caseId}/>}
    {message && <p className="text-xs mt-2" style={{color:'#92400E'}}>{message}</p>}
  </section>;
}
