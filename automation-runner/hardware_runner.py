"""Isolated hardware case runner. Uses vendor DLLs from a configured SDK directory."""
import ctypes as c, json, math, os, pathlib, re, sys, threading, time, uuid
from case_model import load_case, execution_order, resolve_paths, validate_steps
if sys.stdout is not None and hasattr(sys.stdout,"reconfigure"): sys.stdout.reconfigure(encoding="utf-8",errors="replace")
if sys.stderr is not None and hasattr(sys.stderr,"reconfigure"): sys.stderr.reconfigure(encoding="utf-8",errors="replace")

SDK = pathlib.Path(os.environ.get('CANVAS_SDK_DIR', r'D:\IDE_resently\pixelide_release\PixelIDE'))
class Hardware:
 def __init__(self):
  self.directory=os.add_dll_directory(str(SDK)); os.environ['QT_QPA_PLATFORM_PLUGIN_PATH']=str(SDK/'platforms'); os.environ['QT_QPA_PLATFORM']='offscreen'
  self.d=c.WinDLL(str(SDK/'testlib.dll')); self.dev=None; self.relay=None; self.port=None
  V=c.c_void_p; B=c.c_bool; I=c.c_int; U=c.c_uint32
  signatures={'init_qt':([],None),'get_device':([c.c_char_p],V),'device_setConfigure':([V,c.c_char_p],None),'device_open':([V],B),'device_close':([V],None),'device_open_video':([V],B),'device_grab_one_frame':([V],B),'device_grab_one_frame_save':([V,c.c_char_p,c.c_char_p],B),'device_get_fps':([V,c.POINTER(c.c_float)],B),'device_get_current_DN':([V,c.POINTER(c.c_float)],B),'device_I2C_Read':([V,c.c_uint8,U,c.POINTER(U),I,I],B),'device_I2C_Write':([V,c.c_uint8,U,U,I,I],B),'get_switcher':([c.c_char_p],V),'switcher_open':([V],B),'switcher_close':([V],B),'switcher_open_channel':([V,I],B),'switcher_close_channel':([V,I],B)}
  for name,(args,result) in signatures.items():
   f=getattr(self.d,name); f.argtypes=args; f.restype=result
  self.d.init_qt()
 def relay_connect(self,port):
  if self.relay:
   if self.port!=port: raise RuntimeError('同一流程不能切换继电器串口')
   return
  h=self.d.get_switcher(port.encode('utf-8'))
  if not h or not self.d.switcher_open(h): raise RuntimeError(f'无法打开继电器 {port}；检查串口占用和连接')
  self.relay=h; self.port=port
 def close(self):
  if self.dev: self.d.device_close(self.dev); self.dev=None; print('设备连接已关闭',flush=True)
  if self.relay:
   ok=self.d.switcher_close(self.relay); self.relay=None
   if not ok: raise RuntimeError('关闭继电器连接失败')
 def run(self,node):
  typ=node['type']; p=node['params']
  if typ=='wait': time.sleep(p['seconds']);return '等待完成'
  if typ=='firmware_backup':
   if self.dev: raise RuntimeError('固件备份前请先关闭设备')
   length=int(str(p['length']),0); address=int(str(p['address']),0); target=pathlib.Path(p['output']).resolve()
   if target.exists():raise ValueError('备份文件已存在')
   buf=(c.c_uint8*length)(); lib=c.WinDLL(str(SDK/'MatFwHandler_x64.dll')); callback_type=c.CFUNCTYPE(None,c.c_int,c.c_int,c.c_int)
   event=threading.Event(); result={}
   def notify(status,progress,error):
    print(f'固件读取：状态 {status}，进度 {progress}%，错误码 {error}',flush=True)
    if status in (2,3,4):result.update(status=status,error=error);event.set()
   callback=callback_type(notify);lib.MatFwUpload.argtypes=[c.c_char_p,c.c_uint32,c.c_uint32,c.POINTER(c.c_uint8),callback_type];lib.MatFwUpload.restype=c.c_int
   rc=lib.MatFwUpload(os.fsencode(p['ini']),address,length,buf,callback)
   if rc!=0:raise RuntimeError(f'固件读取启动失败，错误码 {rc}')
   while not event.wait(60):print('固件读取仍在进行或等待回调',flush=True)
   if result['status']!=2 or result['error']!=0:raise RuntimeError(f'固件读取失败或取消：{result}')
   target.parent.mkdir(parents=True,exist_ok=True)
   with target.open('xb') as f:f.write(bytes(buf))
   return f'固件备份已保存：{target}，共 {length} 字节'
  if typ=='firmware':
   if self.dev: raise RuntimeError('固件下载前请先关闭设备')
   lib=c.WinDLL(str(SDK/'MatFwHandler_x64.dll')); callback_type=c.CFUNCTYPE(None,c.c_int,c.c_int,c.c_int)
   event=threading.Event(); result={}
   def notify(status,progress,error):
    print(f'固件下载：状态 {status}，进度 {progress}%，错误码 {error}',flush=True)
    if status in (2,3,4): result.update(status=status,error=error);event.set()
   callback=callback_type(notify); lib.MatFwDownload.argtypes=[c.c_char_p,c.c_char_p,callback_type];lib.MatFwDownload.restype=c.c_int
   rc=lib.MatFwDownload(os.fsencode(p['ini']),os.fsencode(p['firmware']),callback)
   if rc!=0: raise RuntimeError(f'固件下载启动失败，错误码 {rc}')
   print('已启动下载，等待终态回调；请勿中断或断电',flush=True)
   while not event.wait(60): print('固件下载仍在进行或等待回调，请勿中断',flush=True)
   if result['status']!=2 or result['error']!=0: raise RuntimeError(f'固件下载失败或取消：{result}')
   return '固件下载回调报告成功'
  if typ=='binary_patch':
   source=pathlib.Path(p['source']).resolve(); target=pathlib.Path(p['output']).resolve()
   if source==target or target.exists():raise ValueError('输出必须是不存在的新文件，不能覆盖源文件')
   offset=int(str(p['offset']),0); patch=bytes.fromhex(p['hex_bytes']); data=bytearray(source.read_bytes())
   if offset<0 or not patch or offset+len(patch)>len(data):raise ValueError('修改范围超出固件文件')
   target.parent.mkdir(parents=True,exist_ok=True)
   with target.open('xb') as f:f.write(data[:offset]);f.write(patch);f.write(data[offset+len(patch):])
   return f'已生成固件副本 {target}，偏移 0x{offset:X}，修改 {len(patch)} 字节；未重算校验值'
  if typ in ('relay_on','relay_off'):
   self.relay_connect(p['port']); channel=int(p['channel'])
   if not 0<=channel<=3: raise ValueError('继电器通道必须为 0–3')
   fn=self.d.switcher_open_channel if typ=='relay_on' else self.d.switcher_close_channel
   if not fn(self.relay,channel):raise RuntimeError('继电器通道操作失败')
   return f'{p["port"]} Channel {channel} 操作成功'
  if typ=='power_on':
   if self.dev:raise RuntimeError('设备已经打开')
   self.dev=self.d.get_device(b'MAT130V300')
   if not self.dev:raise RuntimeError('设备句柄创建失败')
   self.d.device_setConfigure(self.dev,os.fsencode(p['ini'])); time.sleep(3)
   if not self.d.device_open(self.dev):raise RuntimeError('设备打开失败')
   if not self.d.device_open_video(self.dev):raise RuntimeError('视频流打开失败')
   time.sleep(4);return '设备和视频流已打开'
  if typ=='power_off':
   if not self.dev: raise RuntimeError('设备尚未打开')
   self.d.device_close(self.dev); self.dev=None;return '设备已关闭'
  if typ in ('i2c_read','i2c_write'):
   if not self.dev:raise RuntimeError('请先上电')
   number=lambda v:int(v,0) if isinstance(v,str) else int(v)
   slave,reg=number(p['slave']),number(p['register']); ab,db=number(p['address_bits']),number(p['data_bits'])
   if not (0<=slave<=255 and ab in (8,16,32) and db in (8,16,32) and 0<=reg<2**ab):raise ValueError('I²C 参数超出范围')
   if typ=='i2c_read':
    val=c.c_uint32();ok=self.d.device_I2C_Read(self.dev,slave,reg,c.byref(val),ab,db)
    if not ok:raise RuntimeError('I²C 读取失败')
    expected=p.get('expected','')
    if expected!='':
     expected=number(expected); mask=number(p.get('mask',hex((1<<db)-1)))
     if (val.value&mask)!=(expected&mask):raise RuntimeError(f'I²C 断言失败：实际 0x{val.value:X}，期望 0x{expected:X}，掩码 0x{mask:X}')
    return f'[r] 0x{reg:0{ab//4}x} 0x{val.value:0{db//4}x}'
   value=number(p['value'])
   if not 0<=value<2**db:raise ValueError('I²C 值超出位宽')
   if not self.d.device_I2C_Write(self.dev,slave,reg,value,ab,db):raise RuntimeError('I²C 写入失败')
   return f'[w] 0x{reg:0{ab//4}x} 0x{value:0{db//4}x}'
  if typ in ('capture','metrics'):
   if not self.dev:raise RuntimeError('请先上电')
   if typ=='capture':
    if not self.d.device_grab_one_frame(self.dev):raise RuntimeError('抓帧失败')
    path=pathlib.Path(p['output']).resolve();path.parent.mkdir(parents=True,exist_ok=True)
    prefix=path.name+'_'+uuid.uuid4().hex[:10]
    if not self.d.device_grab_one_frame_save(self.dev,os.fsencode(str(path.parent)),os.fsencode(prefix)):raise RuntimeError('保存图像失败')
    files=[f for f in path.parent.iterdir() if f.name.startswith(prefix+'_') and f.is_file() and f.stat().st_size>0]
    if len(files)!=1: raise RuntimeError('无法确定抓图输出文件')
    result=f'原始帧已保存：{files[0]}'
    artifacts={'raw':str(files[0])}
    match=re.search(r'_(\d+)x(\d+)x16\.yuyv$',files[0].name,re.IGNORECASE)
    if match:
     try:
      import numpy as np
      from PIL import Image
      w,h=map(int,match.groups()); raw=np.fromfile(files[0],dtype=np.uint8)
      if w%2 or raw.size!=w*h*2: raise ValueError('原始帧尺寸不匹配')
      a=raw.reshape(h,w//2,4).astype(np.float32); y=np.empty((h,w),dtype=np.float32); y[:,0::2]=a[:,:,0]; y[:,1::2]=a[:,:,2]
      u=np.repeat(a[:,:,1],2,axis=1)-128; v=np.repeat(a[:,:,3],2,axis=1)-128; y=(y-16)*1.164383
      rgb=np.stack((y+1.596027*v,y-.391762*u-.812968*v,y+2.017232*u),axis=2).clip(0,255).astype(np.uint8)
      preview=files[0].with_suffix('.png'); Image.fromarray(rgb).save(preview);artifacts['preview']=str(preview); result+=f'；BT.601 预览：{preview}'
     except Exception as exc: result+=f'；预览生成失败：{exc}'
    return {'message':result,'artifacts':artifacts}
   if not self.d.device_grab_one_frame(self.dev):raise RuntimeError('抓帧失败，无法读取指标')
   fps=c.c_float();dn=c.c_float()
   if not self.d.device_get_fps(self.dev,c.byref(fps)) or not self.d.device_get_current_DN(self.dev,c.byref(dn)):raise RuntimeError('读取 FPS / DN 失败')
   for key,value in (('fps',fps.value),('dn',dn.value)):
    if p.get(key+'_min','')!='' and value<float(p[key+'_min']):raise RuntimeError(f'{key} {value:.3f} 低于下限')
    if p.get(key+'_max','')!='' and value>float(p[key+'_max']):raise RuntimeError(f'{key} {value:.3f} 高于上限')
   return f'FPS={fps.value:.3f}, DN={dn.value:.3f}'
  raise ValueError(f'节点 {typ} 尚未接入真实执行')

def emit(event,**data):
 print('@@CANVAS_EVENT@@'+json.dumps({'event':event,**data},ensure_ascii=False),flush=True)

def main(path):
 appdir=os.environ.get('CANVAS_APP_DIR',str(pathlib.Path(__file__).resolve().parent))
 data=resolve_paths(load_case(path),path,appdir); nodes=execution_order(data)
 if not nodes:raise ValueError('Case 没有节点')
 validate_steps(nodes)
 hw=Hardware();failures=[]
 try:
  for i,n in enumerate(nodes,1):
   emit('step_start',index=i,total=len(nodes),type=n['type'],params=n['params'])
   started=time.perf_counter()
   try:
    result=hw.run(n)
    if isinstance(result,dict):emit('step_done',index=i,type=n['type'],elapsed=time.perf_counter()-started,**result)
    else:emit('step_done',index=i,type=n['type'],elapsed=time.perf_counter()-started,message=str(result))
   except Exception as exc:
    continued=n['type'] in ('i2c_read','i2c_write','metrics','capture')
    failures.append({'index':i,'type':n['type'],'message':str(exc)})
    emit('step_error',index=i,type=n['type'],message=str(exc),continued=continued)
    if not continued:raise
 finally:hw.close()
 emit('run_complete',failed_count=len(failures),failures=failures)
 print('真实流程完成'+(f'，{len(failures)} 个步骤失败' if failures else ''),flush=True)
 return 2 if failures else 0
if __name__=='__main__':
 try:sys.exit(main(sys.argv[1]))
 except Exception as exc: print('执行失败：'+str(exc),flush=True);sys.exit(1)
