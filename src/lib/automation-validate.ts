type Entry={id:string;type:string;params:Record<string,unknown>};
export function validateLocalGraph(graph:unknown): string | null {
 const g=graph as {version:number;nodes:Entry[];edges:Array<{from:string;to:string}>};
 if(!g||g.version!==2||!Array.isArray(g.nodes)||!Array.isArray(g.edges)||!g.nodes.length||g.nodes.length>100)return '流程为空或格式无效';
 const allowed=new Set(['wait','relay_on','relay_off','power_on','power_off','i2c_read','i2c_write','i2c_compare','capture','metrics','firmware','firmware_backup','binary_patch']),map=new Map<string,Entry>(),next=new Map<string,string>(),incoming=new Set<string>();
 for(const n of g.nodes){if(!n||typeof n.id!=='string'||!n.id||map.has(n.id)||!allowed.has(n.type)||!n.params||typeof n.params!=='object')return '节点无效或不支持';map.set(n.id,n)}
 for(const e of g.edges){if(!map.has(e.from)||!map.has(e.to)||e.from===e.to||next.has(e.from)||incoming.has(e.to))return '连线无效';next.set(e.from,e.to);incoming.add(e.to)}
 const starts=[...map.keys()].filter(k=>!incoming.has(k));if(starts.length!==1)return '请将节点连接成一条完整流程';let cur:string|undefined=starts[0];const visited=new Set<string>();let opened=false,seconds=0;
 const num=(v:unknown)=>typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;
 while(cur){if(visited.has(cur))return '流程包含循环';visited.add(cur);const n=map.get(cur)!;const p=n.params;
  if(n.type==='power_on'){if(opened)return '设备已打开';opened=true}if(n.type==='power_off'){if(!opened)return '设备尚未打开';opened=false}
  if(['i2c_read','i2c_write','i2c_compare','capture','metrics'].includes(n.type)&&!opened)return '请先添加设备上电节点';
  if(['firmware','firmware_backup'].includes(n.type)&&opened)return '固件操作前请先关闭设备';
  if(['power_on','firmware','firmware_backup'].includes(n.type)&&(!p.ini||typeof p.ini!=='string'))return '请填写初始化 INI 路径';
  if(n.type==='firmware'&&(!p.firmware||typeof p.firmware!=='string'))return '请填写固件路径';
  if(n.type==='firmware_backup'){const address=num(p.address),length=num(p.length);if(!Number.isInteger(address)||address<0||!Number.isInteger(length)||length<1||length>16777216||address+length>2**32||!p.output)return '固件备份参数无效'}
  if(n.type==='binary_patch'){const offset=num(p.offset),hex=String(p.hex_bytes||'').replace(/\s/g,'');if(!p.source||!p.output||!Number.isInteger(offset)||offset<0||!hex||hex.length%2||!/^[0-9a-f]+$/i.test(hex))return '固件修改参数无效'}
  if(n.type==='capture'&&!p.output)return '请填写抓图输出路径';
  if(['relay_on','relay_off'].includes(n.type)&&(!p.port||!Number.isInteger(num(p.channel))||num(p.channel)<0||num(p.channel)>3))return '继电器参数无效';
  if(n.type==='wait'){const t=num(p.seconds);if(!Number.isFinite(t)||t<0||t>86400)return '等待时间无效';seconds+=t}
  if(n.type==='i2c_read'||n.type==='i2c_write'||n.type==='i2c_compare'){const a=num(p.slave),r=num(p.register),ab=num(p.address_bits),db=num(p.data_bits);if(!Number.isInteger(a)||a<0||a>255||![8,16,32].includes(ab)||![8,16,32].includes(db)||!Number.isInteger(r)||r<0||r>=2**ab)return 'I²C 地址或位宽无效';if(n.type==='i2c_compare'){const count=num(p.count),interval=num(p.interval);if(!Number.isInteger(count)||count<2||count>20||!Number.isFinite(interval)||interval<0.05||interval>30||count*interval>120||!['stable','increasing'].includes(String(p.mode)))return '重复读取比较参数无效'}if(n.type==='i2c_write'&&(!Number.isInteger(num(p.value))||num(p.value)<0||num(p.value)>=2**db))return 'I²C 写入值无效';if(n.type==='i2c_read'&&p.expected!==''&&p.expected!==undefined){const x=num(p.expected),mask=num(p.mask??'0xffffffff');if(!Number.isInteger(x)||x<0||x>=2**db||!Number.isInteger(mask)||mask<0||mask>0xffffffff)return 'I²C 期望值或掩码无效'}}
  if(n.type==='metrics')for(const k of ['fps','dn']){const lo=p[k+'_min'],hi=p[k+'_max'];if(lo!==''&&lo!==undefined&&!Number.isFinite(num(lo))||hi!==''&&hi!==undefined&&!Number.isFinite(num(hi)))return '指标范围无效';if(lo!==''&&lo!==undefined&&hi!==''&&hi!==undefined&&num(lo)>num(hi))return '指标下限不能大于上限'}
  cur=next.get(cur)
 }
 if(visited.size!==map.size)return '流程有未连接节点';return null;
}
