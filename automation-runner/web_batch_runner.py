"""Serially execute explicitly selected saved flows on the single local device."""
import json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parent;manifest=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=False)
plan=json.loads(manifest.read_text(encoding='utf8'));result={'state':'运行中','cases':[],'error':None};(out/'progress.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf8')
try:
 for item in plan['cases']:
  folder=out/('case-'+str(item['caseId']));proc=subprocess.run([sys.executable,str(root/'web_repeat_runner.py'),item['snapshot'],str(folder),str(plan['repeat'])],cwd=str(root),capture_output=True,text=True,encoding='utf8',errors='replace')
  try:r=json.loads((folder/'results.json').read_text(encoding='utf8'))
  except (OSError,ValueError):r={'state':'中断','error':'执行器未生成结果','diagnostics':proc.stderr[-3000:]}
  result['cases'].append({'caseId':item['caseId'],'caseNo':item['caseNo'],'result':r});(out/'progress.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf8')
  if proc.returncode!=0 or r.get('state')=='中断':result['error']=r.get('error') or '关键步骤中断';break
 result['state']='中断' if result['error'] else '有失败' if any(c['result'].get('state')=='有失败' for c in result['cases']) else '执行完成（未自动判定整条用例）'
except Exception as e:result['state']='中断';result['error']=str(e)
finally:(out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result,ensure_ascii=False),flush=True)
