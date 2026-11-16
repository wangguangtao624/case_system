"""Run a fixed canvas snapshot repeatedly; preserve every round and stop on critical failure."""
import json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parent;snapshot=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);count=int(sys.argv[3])
if not 1<=count<=10000:raise ValueError('重复次数须为 1 到 10000')
out.mkdir(parents=True,exist_ok=False);rounds=[];overall={'state':'运行中','rounds':rounds,'preview':None,'error':None}
(out/'progress.json').write_text(json.dumps(overall,ensure_ascii=False),encoding='utf8')
try:
 for index in range(1,count+1):
  folder=out/f'第{index:03d}轮';p=subprocess.run([sys.executable,str(root/'web_flow_runner.py'),str(snapshot),str(folder)],cwd=str(root),capture_output=True,text=True,encoding='utf8',errors='replace')
  try:result=json.loads((folder/'results.json').read_text(encoding='utf8'))
  except (OSError,ValueError):result={'state':'failed','error':'执行器未生成结果','diagnostics':p.stderr[-3000:]}
  rounds.append({'index':index,'result':result});overall['preview']=result.get('preview') or overall['preview'];(out/'progress.json').write_text(json.dumps(overall,ensure_ascii=False),encoding='utf8')
  if p.returncode!=0 or result.get('state')=='failed' or any('失败' in x for x in result.get('cleanup',[])):overall['error']=result.get('error') or '关键步骤或结束处理失败';break
 overall['state']='中断' if overall['error'] else '有失败' if any(r['result'].get('state')=='有失败' for r in rounds) else '执行完成（未自动判定整条用例）'
 if rounds:overall['steps']=rounds[-1]['result'].get('steps',[]);overall['cleanup']=rounds[-1]['result'].get('cleanup',[])
except Exception as e:overall['state']='中断';overall['error']=str(e)
finally:(out/'results.json').write_text(json.dumps(overall,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(overall,ensure_ascii=False),flush=True)
