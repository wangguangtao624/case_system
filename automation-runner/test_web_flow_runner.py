import contextlib,io,json,pathlib,runpy,sys,tempfile,unittest
import hardware_runner

class WebRunnerTests(unittest.TestCase):
 def run_flow(self,specs,hardware,base):
  nodes=[{'id':str(i),'type':typ,'params':params,'x':0,'y':0} for i,(typ,params) in enumerate(specs)]
  graph={'version':2,'nodes':nodes,'edges':[{'from':a['id'],'to':b['id']} for a,b in zip(nodes,nodes[1:])]}
  snapshot=base/'flow.json';snapshot.write_text(json.dumps(graph),encoding='utf8');output=base/'run';old=hardware_runner.Hardware;argv=sys.argv;hardware_runner.Hardware=hardware;sys.argv=['web_flow_runner.py',str(snapshot),str(output)]
  try:
   with contextlib.redirect_stdout(io.StringIO()):runpy.run_path('web_flow_runner.py',run_name='__main__')
  finally:hardware_runner.Hardware=old;sys.argv=argv
  return json.loads((output/'results.json').read_text(encoding='utf8'))
 def test_failure_turns_off_same_relay_channel(self):
  calls=[]
  class Device:
   def __init__(self):self.dev=None
   def run(self,n):
    calls.append((n['type'],n['params'].copy()))
    if n['type']=='power_on':raise RuntimeError('simulated failure')
    return 'ok'
   def close(self):pass
  with tempfile.TemporaryDirectory() as tmp:
   base=pathlib.Path(tmp);ini=base/'custom.ini';ini.write_text('x')
   result=self.run_flow([('relay_on',{'port':'COM7','channel':2}),('power_on',{'ini':str(ini)})],Device,base)
  self.assertEqual(result['state'],'failed');self.assertEqual(calls[-1],('relay_off',{'port':'COM7','channel':2}));self.assertEqual(calls[1][1]['ini'],str(ini))
 def test_external_preview_is_copied_into_run_artifacts(self):
  class Device:
   def __init__(self):self.dev=None
   def run(self,n):
    if n['type']=='power_on':self.dev=True
    if n['type']=='power_off':self.dev=None
    if n['type']=='capture':
     preview=pathlib.Path(n['params']['output']).with_suffix('.png');preview.write_bytes(b'picture');return {'message':'saved','artifacts':{'preview':str(preview)}}
    return 'ok'
   def close(self):pass
  with tempfile.TemporaryDirectory() as tmp:
   base=pathlib.Path(tmp);ini=base/'custom.ini';ini.write_text('x');external=base/'outside';external.mkdir()
   result=self.run_flow([('power_on',{'ini':str(ini)}),('capture',{'output':str(external/'custom')}),('power_off',{})],Device,base)
   self.assertEqual(pathlib.Path(result['preview']).read_bytes(),b'picture');self.assertEqual(pathlib.Path(result['preview']).parent.resolve(),(base/'run').resolve());self.assertTrue((external/'custom.png').exists())
 def test_firmware_nodes_pass_paths_to_mock_without_flashing(self):
  calls=[]
  class Device:
   def __init__(self):self.dev=None
   def run(self,n):calls.append((n['type'],n['params'].copy()));return 'simulated'
   def close(self):pass
  with tempfile.TemporaryDirectory() as tmp:
   base=pathlib.Path(tmp);ini=base/'custom.ini';firmware=base/'image.bin';ini.write_text('x');firmware.write_bytes(b'ABCD')
   result=self.run_flow([('firmware',{'ini':str(ini),'firmware':str(firmware)}),('binary_patch',{'source':str(firmware),'output':'${RUNDIR}/new.bin','offset':'0x0','hex_bytes':'42'})],Device,base)
   self.assertEqual(result['state'],'执行完成（未自动判定整条用例）');self.assertEqual(calls[0][1]['firmware'],str(firmware));self.assertEqual(calls[1][1]['output'],str((base/'run'/'new.bin').resolve()))
if __name__=='__main__':unittest.main()
