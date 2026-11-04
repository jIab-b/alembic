"""Native headless Alembic application controller; Vault remains an external pin.

The HTTP queue uses the shared durable Queue. An external cooperative agent claims
work and edits exact staged outputs through VM.run; it never patches live sources.
"""
import argparse,hashlib,json,mimetypes,os,secrets,sqlite3,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
sys.dont_write_bytecode=True
from urllib.parse import urlsplit

def main():
 p=argparse.ArgumentParser();p.add_argument('--project',required=True,type=Path);p.add_argument('--state',required=True,type=Path);a=p.parse_args()
 if sys.platform!='win32':raise RuntimeError('Use native Windows Python')
 root=a.project.resolve();config=json.loads((root/'environment.json').read_text());release=Path(config['vault_package'])
 agent_home=os.environ.get('ALEMBIC_CODEX_HOME');agent_bin=os.environ.get('ALEMBIC_CODEX_BIN')
 if agent_home:os.environ['CODEX_HOME']=str(Path(agent_home).resolve())
 if agent_bin:os.environ['PATH']=str(Path(agent_bin).resolve())+os.pathsep+os.environ.get('PATH','')
 if not config.get('headless_only') or not config.get('windows_host_exception') or (release/'sha').read_text().strip()!=(root/'vault.lock').read_text().strip():raise RuntimeError('Explicit native profile/pin required')
 os.environ.update(VPSCTL_WINDOWS_DEV='1',VPSCTL_DEV='1',SW_STORE=config['vault_store'],VPSCTL_RELEASES_DIR=str(release.parent),PYTHONDONTWRITEBYTECODE='1')
 sys.path.insert(0,str(release));import vpsctl as vc
 from vpsctl import sandbox
 vc.pin_release(root/'vault.lock')
 from agent_queue import Queue,VaultBackend
 from windows_ws_proxy import proxy_websocket
 from preview_server import preview_http_server
 state=a.state.resolve();state.mkdir(parents=True,exist_ok=True);assets=Path(__file__).parent/'frontend/dist';token=secrets.token_urlsafe(32);worker=secrets.token_urlsafe(32);claims={};guard=threading.Lock();stopping=threading.Event();workspace=json.loads((root/'.alembic/project.json').read_text())['id']
 vm=vc.vm(str(root),isolation='none',limits=dict(cpu=4,memory_mb=6144 if config['profile']=='light' else 8192,pids=64));agents=vm.agents();backend=VaultBackend(vm,vm.workspace)
 def queue():return Queue(workspace,state/'queue')
 class Handler(BaseHTTPRequestHandler):
  protocol_version='HTTP/1.1'
  def log_message(self,*_):pass
  def send(self,status,data,kind='application/json',headers=None):
   self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer')
   for name,value in (headers or {}).items():self.send_header(name,value)
   self.end_headers();self.wfile.write(data)
  def do_GET(self):self.route()
  def do_POST(self):self.route()
  def do_PUT(self):self.route()
  def route(self):
   try:self.actual()
   except (BrokenPipeError,ConnectionResetError):pass
   except Exception as exc:self.send(400,json.dumps(dict(error=str(exc))).encode())
  def actual(self):
   origin=f'http://127.0.0.1:{server.server_port}';path=urlsplit(self.path).path
   if self.headers.get('Host')!=origin.removeprefix('http://') or self.headers.get('Origin') not in (None,origin):self.send(403,b'{}');return
   if self.command=='GET' and (path=='/' or path.startswith('/assets/')):
    if path=='/assets/agent-queue.json':data=json.dumps(dict(version=1,transport='http-poll',endpoint='/app-queue',worker='external cooperative agent for queued canvas prompts',host_agent_pty=False,host_agent_stream='utf8-jsonl',host_agent_limits='finite')).encode();kind='application/json'
    elif path=='/assets/preview-origin.json':data=json.dumps(dict(controller=origin,workspaces={workspace:f'http://127.0.0.1:{preview.server_port}'})).encode();kind='application/json'
    else:
     relative='index.html' if path=='/' else path.lstrip('/');file=(assets/relative).resolve()
     if not file.is_relative_to(assets) or not file.is_file():self.send(404,b'{}');return
     data=file.read_bytes();kind=mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
    self.send(200,data,kind,{'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self' blob: ws://127.0.0.1:* ws://localhost:*; frame-src blob: http://127.0.0.1:* http://localhost:*; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"});return
   if self.headers.get('Upgrade','').lower()=='websocket':
    if self.headers.get('Origin')!=origin or path!=f'/vms/{vm.id}/call/ws':self.send(403,b'{}');return
    connection=sandbox._connect()
    try:
     try:proxy_websocket(self,connection,self.path)
     except (OSError,ValueError):
      if not self.close_connection:raise
    finally:connection.close()
    return
   worker_route=path.startswith('/worker/');expected=worker if worker_route else token
   if not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+expected):self.send(401,b'{}');return
   length=int(self.headers.get('Content-Length','0'))
   if not 0<=length<=1048576:raise ValueError('bounded application request required')
   body=self.rfile.read(length)
   if path.startswith('/app-queue/') or worker_route:
    payload=json.loads(body) if body else {};q=queue()
    try:
     with guard:
      if path=='/app-queue/jobs' and self.command=='POST':
       if not isinstance(payload.get('file'),str):raise ValueError('current renderable required')
       result=q.enqueue(payload['prompt']+'\n\nCanvas context: '+json.dumps({k:v for k,v in payload.items() if k!='prompt'}),[payload['file']])
      elif path.startswith('/app-queue/jobs/') and self.command=='GET':result=q.get(path.rsplit('/',1)[-1])
      elif path=='/worker/claim' and self.command=='POST':
       claimed=q.claim()
       if claimed is None:result=None
       else:
        job,fd=claimed
        try:
         backend.record(job);base=backend.prepare(job);q.db.execute('UPDATE jobs SET base=? WHERE id=?',(json.dumps(base),job['id']));claims[job['id']]=(fd,base)
         result=dict(job=job['id'],prompt=job['prompt'],targets=job['targets'],base_hashes=base['hashes'],staging=base['staging'],outputs={p:base['staging']+'/'+p for p in job['targets']},vm=vm.id)
        except BaseException as exc:
         q.db.execute("UPDATE jobs SET state='failed',finished=?,error=? WHERE id=?",(time.time(),str(exc),job['id']));os.close(fd);raise
      elif path=='/worker/complete' and self.command=='POST':
       job=q.get(payload['job']);fd,base=claims.pop(job['id'])
       try:
        result=backend.publish(job,payload['outputs'],base);q.db.execute("UPDATE jobs SET state='succeeded',finished=?,result=? WHERE id=?",(time.time(),json.dumps(result),job['id']));result=q.get(job['id'])
       except Exception as exc:q.db.execute("UPDATE jobs SET state='failed',finished=?,error=? WHERE id=?",(time.time(),str(exc),job['id']));raise
       finally:os.close(fd)
      elif path=='/worker/status':result=q.jobs()
      elif path=='/worker/stop':stopping.set();result=dict(stopping=True)
      else:raise ValueError('unknown application queue operation')
     with (state/'queue-events.jsonl').open('a',encoding='utf-8') as events:events.write(json.dumps(dict(path=path,method=self.command,job=result.get('id') if isinstance(result,dict) else None,state=result.get('state') if isinstance(result,dict) else None,time=time.time()))+'\n')
     self.send(200,json.dumps(result).encode());return
    finally:q.db.close()
   if self.command=='POST' and path==f'/vms/{vm.id}/launch':
    payload=json.loads(body) if body else {}
    env={'PATH':os.environ.get('PATH','')}
    if agent_home:env['CODEX_HOME']=str(Path(agent_home).resolve())
    payload['env']=env;body=json.dumps(payload).encode();length=len(body)
   # Forward the genuine external Vault protocol. Browser receives only an app
   # bearer; Vault credentials stay in this controller outside the command VM.
   connection=sandbox._connect();connection.request(self.command,self.path,body=body if length else None,headers={'Content-Type':self.headers.get('Content-Type','application/json')});response=connection.getresponse()
   try:
    self.send_response(response.status)
    for name,value in response.getheaders():
     if name.lower() not in ('transfer-encoding','connection','access-control-allow-origin','vary'):self.send_header(name,value)
    if response.getheader('Content-Length') is None:self.send_header('Connection','close');self.close_connection=True
    self.end_headers()
    if response.getheader('Content-Type','').startswith('text/event-stream'):
     while not stopping.is_set():
      data=response.read1(65536)
      if not data:break
      self.wfile.write(data);self.wfile.flush()
    else:self.wfile.write(response.read())
   finally:connection.close()
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
 preview=preview_http_server(assets/'assets',f'http://127.0.0.1:{server.server_port}')
 for service in (server,preview):threading.Thread(target=service.serve_forever,daemon=True).start()
 import ctypes
 from ctypes import wintypes
 ctypes.windll.kernel32.GetCurrentProcess.restype=wintypes.HANDLE
 ctypes.windll.kernel32.GetProcessTimes.argtypes=[wintypes.HANDLE]+[ctypes.POINTER(wintypes.FILETIME)]*4
 created=wintypes.FILETIME();exited=wintypes.FILETIME();kernel=wintypes.FILETIME();user=wintypes.FILETIME()
 if not ctypes.windll.kernel32.GetProcessTimes(ctypes.windll.kernel32.GetCurrentProcess(),ctypes.byref(created),ctypes.byref(exited),ctypes.byref(kernel),ctypes.byref(user)):raise OSError('Cannot identify native controller process')
 creation=(created.dwHighDateTime << 32) | created.dwLowDateTime
 launch=dict(protocol_version=1,capabilities=['open_project'],pid=os.getpid(),process_created=creation,base=f'http://127.0.0.1:{server.server_port}',token=token,worker_token=worker,workspace=workspace,vm=vm.id,agents=agents,preview=f'http://127.0.0.1:{preview.server_port}',project=str(root),package=str(release))
 (state/'connection.private.json').write_text(json.dumps(launch));print(json.dumps(dict(ready=True,workspace=workspace,vm=vm.id,headless_only=True,filesystem_isolated=False,agents=agents,host_agent_pty=False)),flush=True)
 try:
  while not stopping.wait(.5):
   if (state/'stop').exists():break
 finally:
  for fd,_ in claims.values():os.close(fd)
  server.shutdown();preview.shutdown();vm.stop();vc.stop_vault();(state/'connection.private.json').unlink(missing_ok=True);(state/'stop').unlink(missing_ok=True)
if __name__=='__main__':main()
