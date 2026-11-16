"""Local read-only AP pilot. Explicit relay cycle; never writes registers or firmware."""
import json,os,pathlib,sys,time,traceback
ROOT=pathlib.Path(__file__).resolve().parent
os.environ['CANVAS_SDK_DIR']=str(ROOT/'dist/设备测试画布/sdk')
from hardware_runner import Hardware
out=pathlib.Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=False)
ini=ROOT/'dist/设备测试画布/assets/device.ini'; selected=sys.argv[2] if len(sys.argv)>2 else None;hw=None;relay=False;result={'cases':[],'preview':None,'error':None,'cleanup':[]}
def step(typ,params):return hw.run({'type':typ,'params':params})
def read(reg):
 value=step('i2c_read',{'slave':'0x40','register':reg,'address_bits':16,'data_bits':32,'expected':'','mask':'0xffffffff'})
 return int(value.split()[-1],16)
try:
 hw=Hardware();step('relay_on',{'port':'COM3','channel':0});relay=True;time.sleep(1);step('power_on',{'ini':str(ini)})
 img=step('capture',{'output':str(out/'capture')});result['preview']=img.get('artifacts',{}).get('preview');result['capture']=img
 for code,reg in [('FW_AP_Interaction_002','0x0928'),('FW_AP_Interaction_003','0x0924'),('FW_AP_Interaction_011','0x092c')]:
  if selected and selected!=code:continue
  item={'case_no':code,'register':reg,'values':[],'status':'未完成','basis':'参考 MAT330 预期，目标型号待复核'};result['cases'].append(item)
  try:
   count=1 if code.endswith('011') else 3
   for i in range(count):
    if i:time.sleep(1)
    item['values'].append(read(reg))
   v=item['values']; passed=(len(set(v))==1 if code.endswith('002') else all(b>a for a,b in zip(v,v[1:])) if code.endswith('003') else v[0]==1)
   if code.endswith('002'):item['status']='读数稳定，模式含义待确认' if passed else '读数不一致'
   elif code.endswith('003'):item['status']='读数递增，计数单位待确认' if passed else '读数未持续递增'
   else:item['status']='参考值匹配，目标版本待确认' if passed else '读数与参考值不同，位宽和字节位置待确认'
  except Exception as e:item['status']='读取失败';item['error']=str(e)
except Exception as e:result['error']=str(e);result['trace']=traceback.format_exc()
finally:
 if hw:
  try:
   if hw.dev:step('power_off',{});result['cleanup'].append('设备已关闭')
  except Exception as e:result['cleanup'].append('设备关闭失败：'+str(e))
  try:
   if relay:step('relay_off',{'port':'COM3','channel':0});result['cleanup'].append('继电器已关')
  except Exception as e:result['cleanup'].append('继电器关闭失败：'+str(e))
  try:hw.close()
  except Exception as e:result['cleanup'].append('连接关闭失败：'+str(e))
 (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
 print('@@PILOT@@'+json.dumps(result,ensure_ascii=False),flush=True)
