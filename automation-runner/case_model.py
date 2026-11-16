"""Case graph persistence and deterministic execution ordering."""
import json
import pathlib
import uuid

def load_case(path):
 data=json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
 nodes=data.get('nodes')
 if not isinstance(nodes,list): raise ValueError('Case 缺少节点列表')
 if data.get('version') == 1:
  nodes=[dict(n,id=uuid.uuid4().hex) for n in nodes]
  order=sorted(nodes,key=lambda n:n['x'])
  return {'version':2,'nodes':nodes,'edges':[{'from':a['id'],'to':b['id']} for a,b in zip(order,order[1:])]}
 if data.get('version') != 2 or not isinstance(data.get('edges'),list): raise ValueError('不支持的 Case 格式')
 return data

def execution_order(case):
 nodes=case['nodes']; edges=case['edges']
 if not nodes: raise ValueError('Case 没有节点')
 ids=[n.get('id') for n in nodes]
 if any(not isinstance(i,str) or not i for i in ids) or len(ids)!=len(set(ids)): raise ValueError('节点 ID 无效或重复')
 lookup={n['id']:n for n in nodes}; outgoing={}; incoming={}
 for edge in edges:
  a,b=edge.get('from'),edge.get('to')
  if a not in lookup or b not in lookup or a==b: raise ValueError('连线端点无效')
  if a in outgoing or b in incoming: raise ValueError('目前每个节点最多一条输入和一条输出连线')
  outgoing[a]=b; incoming[b]=a
 starts=[i for i in ids if i not in incoming]
 if len(starts)!=1: raise ValueError('请将所有节点连接为一条完整流程')
 ordered=[]; current=starts[0]
 while current is not None:
  if current in ordered: raise ValueError('流程包含循环')
  ordered.append(current); current=outgoing.get(current)
 if len(ordered)!=len(nodes): raise ValueError('流程包含循环或未连接的节点')
 return [lookup[i] for i in ordered]


def resolve_paths(case, case_path, app_dir, run_dir=None):
 import copy
 result=copy.deepcopy(case); roots={'${APPDIR}':str(pathlib.Path(app_dir).resolve()),'${CASEDIR}':str(pathlib.Path(case_path).resolve().parent),'${RUNDIR}':str(pathlib.Path(run_dir).resolve() if run_dir else pathlib.Path(case_path).resolve().parent/'测试结果'/'预览')}
 for node in result['nodes']:
  for key in ('ini','firmware','source','output'):
   val=node.get('params',{}).get(key)
   if isinstance(val,str):
    for token,base in roots.items():
     if val==token or val.startswith(token+'/') or val.startswith(token+'\\'):
      node['params'][key]=str(pathlib.Path(base)/val[len(token):].lstrip('/\\'));break
 return result


def validate_steps(nodes):
 import math
 def number(v): return int(v,0) if isinstance(v,str) else int(v)
 supported={'wait','relay_on','relay_off','power_on','power_off','i2c_read','i2c_write','i2c_compare','metrics','capture','firmware','binary_patch','firmware_backup'}
 opened=False
 for i,n in enumerate(nodes,1):
  typ=n.get('type');p=n.get('params')
  try:
   if typ not in supported or not isinstance(p,dict):raise ValueError('未知节点或参数格式错误')
   if typ=='wait' and (not isinstance(p.get('seconds'),(int,float)) or isinstance(p['seconds'],bool) or not math.isfinite(p['seconds']) or not 0<=p['seconds']<=86400):raise ValueError('等待时间应在 0 到 86400 秒之间')
   if typ in ('relay_on','relay_off') and (not isinstance(p.get('port'),str) or not p['port'].strip() or number(p['channel']) not in range(4)):raise ValueError('继电器串口或通道无效')
   if typ in ('power_on','firmware','firmware_backup') and not pathlib.Path(p.get('ini','')).is_file():raise ValueError('INI 文件不存在')
   if typ=='power_on':
    if opened:raise ValueError('设备已经打开，请先添加设备下电节点')
    opened=True
   if typ=='power_off':
    if not opened:raise ValueError('设备未打开，请先添加设备上电节点')
    opened=False
   if typ in ('i2c_read','i2c_write','i2c_compare','metrics','capture') and not opened:raise ValueError('请在此节点前添加设备上电节点')
   if typ in ('firmware','firmware_backup') and opened:raise ValueError('请在固件操作前添加设备下电节点')
   if typ=='firmware' and not pathlib.Path(p.get('firmware','')).is_file():raise ValueError('固件文件不存在')
   if typ=='firmware_backup':
    address=number(p['address']);length=number(p['length'])
    if address<0 or not 0<length<=16*1024*1024 or address+length>2**32 or not p.get('output') or pathlib.Path(p['output']).exists():raise ValueError('备份地址、长度或输出路径无效，输出文件不能已存在')
   if typ=='binary_patch':
    source=pathlib.Path(p['source']).resolve(); target=pathlib.Path(p['output']).resolve(); patch=bytes.fromhex(p['hex_bytes']); offset=number(p['offset'])
    if not source.is_file() or target.exists() or source==target or offset<0 or not patch or offset+len(patch)>source.stat().st_size:raise ValueError('固件修改参数无效')
   if typ=='capture' and not p.get('output'):raise ValueError('抓图输出路径为空')
   if typ in ('i2c_read','i2c_write','i2c_compare'):
    slave,reg,ab,db=map(number,(p['slave'],p['register'],p['address_bits'],p['data_bits']))
    if not (0<=slave<=255 and ab in (8,16,32) and db in (8,16,32) and 0<=reg<2**ab):raise ValueError('I²C 地址或位宽无效')
    if typ=='i2c_compare':
     count=number(p['count']);interval=float(p['interval']);mode=p['mode']
     if count<2 or count>20 or not math.isfinite(interval) or not 0.05<=interval<=30 or count*interval>120 or mode not in ('stable','increasing'):raise ValueError('重复读取比较参数无效')
    if typ=='i2c_write' and not 0<=number(p['value'])<2**db:raise ValueError('I²C 写入值超出位宽')
    if typ=='i2c_read' and p.get('expected','')!='':
     if not 0<=number(p['expected'])<2**db or not 0<=number(p.get('mask',hex((1<<db)-1)))<=0xffffffff:raise ValueError('I²C 断言值或掩码无效')
   if typ=='metrics':
    for key in ('fps','dn'):
     lo=p.get(key+'_min','');hi=p.get(key+'_max','')
     if lo!='' and not math.isfinite(float(lo)) or hi!='' and not math.isfinite(float(hi)):raise ValueError('指标范围必须是有限数值')
     if lo!='' and hi!='' and float(lo)>float(hi):raise ValueError('指标下限不能大于上限')
  except (ValueError,TypeError,KeyError,OSError) as e:raise ValueError(f'第 {i} 个节点（{typ}）：{e}') from e


def layout_order(case):
 """Order each connected chain without changing or silently repairing edges."""
 nodes=case['nodes'];lookup={n.get('id'):n for n in nodes}
 if len(lookup)!=len(nodes) or None in lookup:raise ValueError('节点标识无效')
 outgoing={};incoming={}
 for edge in case['edges']:
  a,b=edge.get('from'),edge.get('to')
  if a not in lookup or b not in lookup or a==b or a in outgoing or b in incoming:raise ValueError('连线无效，请先检查连线')
  outgoing[a]=b;incoming[b]=a
 starts=sorted((n for n in nodes if n['id'] not in incoming),key=lambda n:(n['y'],n['x']))
 result=[];visited=set()
 for start in starts:
  current=start['id']
  while current is not None:
   if current in visited:raise ValueError('连线包含循环')
   visited.add(current);result.append(lookup[current]);current=outgoing.get(current)
 if len(result)!=len(nodes):raise ValueError('连线包含循环')
 return result
