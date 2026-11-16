"""Execute an explicitly saved local web canvas with fixed local device paths and validated node types."""
import json,os,pathlib,shutil,sys,time,traceback
ROOT=pathlib.Path(__file__).resolve().parent
os.environ['CANVAS_SDK_DIR']=str(ROOT/'dist/设备测试画布/sdk')
from case_model import load_case,execution_order,resolve_paths,validate_steps
from hardware_runner import Hardware
snapshot=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=False)
result={'state':'运行中','steps':[],'preview':None,'cleanup':[],'error':None};hw=None;relays=set()
def progress():
 (out/'progress.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf8')
try:
 graph=resolve_paths(load_case(snapshot),snapshot,ROOT/'dist/设备测试画布',out);nodes=execution_order(graph)
 allowed={'wait','relay_on','relay_off','power_on','power_off','i2c_read','i2c_write','i2c_compare','capture','metrics','firmware','firmware_backup','binary_patch'}
 if any(n['type'] not in allowed for n in nodes):raise ValueError('存在当前不支持执行的节点')
 validate_steps(nodes);hw=Hardware();failures=0
 for i,n in enumerate(nodes,1):
  typ=n['type'];p=n['params'];entry={'index':i,'type':typ,'status':'运行中','message':''};result['steps'].append(entry);progress()
  try:
   if typ=='i2c_compare':
    readings=[];times=int(p['count'])
    for j in range(times):
     if j:time.sleep(float(p['interval']))
     val=hw.run({'type':'i2c_read','params':p});readings.append(int(str(val).split()[-1],16))
    ok=len(set(readings))==1 if p['mode']=='stable' else all(b>a for a,b in zip(readings,readings[1:]))
    text=' → '.join(f'0x{x:08x}' for x in readings)
    if not ok:raise ValueError('读取比较不符合预期：'+text)
    value=('读取稳定：' if p['mode']=='stable' else '读取递增：')+text
   else:value=hw.run(n)
   if typ=='relay_on':relays.add((str(p['port']),int(p['channel'])))
   if typ=='relay_off':relays.discard((str(p['port']),int(p['channel'])))
   if isinstance(value,dict):
    entry['message']=value.get('message','');entry['artifacts']=value.get('artifacts',{})
    preview=entry['artifacts'].get('preview')
    if preview:
     source=pathlib.Path(preview).resolve()
     if source.parent!=out.resolve():
      copied=out/f'capture_{i:03d}.png';shutil.copy2(source,copied);preview=str(copied)
     entry['artifacts']['preview']=preview;result['preview']=preview
   else:entry['message']=str(value)
   entry['status']='完成';progress()
  except Exception as e:
   failures+=1;entry.update(status='失败',message=str(e));progress()
   if typ not in ('i2c_read','i2c_write','i2c_compare','capture','metrics'):raise
 result['state']='有失败' if failures else '执行完成（未自动判定整条用例）'
except Exception as e:result['state']='failed';result['error']=str(e);result['trace']=traceback.format_exc()
finally:
 if hw:
  try:
   if hw.dev:hw.run({'type':'power_off','params':{}});result['cleanup'].append('设备已关闭')
  except Exception as e:result['cleanup'].append('设备关闭失败：'+str(e))
  for port,channel in sorted(relays):
   try:hw.run({'type':'relay_off','params':{'port':port,'channel':channel}});result['cleanup'].append(f'继电器 {port} 通道 {channel} 已关')
   except Exception as e:result['cleanup'].append(f'继电器 {port} 通道 {channel} 关闭失败：'+str(e))
  try:hw.close()
  except Exception as e:result['cleanup'].append('连接关闭失败：'+str(e))
 (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result,ensure_ascii=False),flush=True)
