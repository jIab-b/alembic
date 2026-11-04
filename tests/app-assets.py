"""Disposable real relay + native Windows browser; no real agent calls."""
import os,sys,tempfile,subprocess,signal,re,shutil
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='app-assets-',dir=os.environ['TMPDIR']) as temp:
 root=Path(temp);os.environ['AL_HOME']=str(root/'home');os.environ['TMPDIR']=str(root/'tmp')
 Path(os.environ['TMPDIR']).mkdir()
 sys.path.insert(0,str(repo/'backend'))
 from common import start,launch_url,rpc,location
 app=root/'app';(app/'assets').mkdir(parents=True)
 (app/'index.html').write_text('<!doctype html><link rel="stylesheet" href="/assets/site.css">'
  '<p id="status">LOADING</p><script type="module" src="/assets/site.js"></script>')
 (app/'assets/site.css').write_text('#status{color:rgb(12,34,56)}')
 (app/'assets/site.js').write_text("import './nested.js';document.querySelector('#status').textContent='APP_BOOTED';")
 (app/'assets/nested.js').write_text("window.nestedAsset='nested module';")
 self_app='--self' in sys.argv
 if '--recover' in sys.argv or '--recover-fail' in sys.argv:
  assets=root/'built';shutil.copytree(os.environ.get('AL_ASSETS',repo/'frontend/dist'),assets)
  os.environ['AL_ASSETS']=str(assets)
  worker=assets/'assets/preview-sw.js'
  worker.write_text("let bypassed=false;self.addEventListener('fetch',event=>{"
   "if(/\\/play\\/app\\/[^/]+\\/index\\.html$/.test(new URL(event.request.url).pathname)&&("+
   ('true' if '--recover-fail' in sys.argv else '!bypassed')+
   ")){bypassed=true;event.respondWith(fetch(event.request));event.stopImmediatePropagation();}});\n"+
   worker.read_text())
 server,info=start(app,'--node','fixture.iframe',*(['--self-app'] if self_app else []))
 try:
  if '--replace' in sys.argv:
   original=info;session=rpc(app,'create')
   server,info=start(app,'--node','fixture.iframe','--replace')
   assert all(info[k]==original[k] for k in ('base','preview','token'))
   assert session in [row['id'] for row in rpc(app,'list')]
  url=root/'url.txt';url.write_text(launch_url(info));url.chmod(0o600)
  win=lambda p:subprocess.check_output(['wslpath','-w',str(p)],text=True).strip()
  name='iframe-reload-browser.mjs' if self_app else 'app-assets-browser.mjs'
  quote=lambda text:"'"+str(text).replace("'","''")+"'"
  script=''
  if os.environ.get('ALEMBIC_DEPS'):
   module=Path(os.environ['ALEMBIC_DEPS'])/'browser-tools/node_modules/playwright'
   script='$env:PLAYWRIGHT_MODULE='+quote(win(module))+';'
  script+='& node '+quote(win(repo/'tests'/name))+' '+quote(win(url))+' '+ ' '.join(map(quote,sys.argv[1:]))
  result=subprocess.run(['powershell.exe','-NoProfile','-Command',script+';exit $LASTEXITCODE'],
   capture_output=True,text=True,timeout=50)
  print(re.sub(r'token=[^&\s]+','token=redacted',result.stdout+result.stderr))
 finally:
  server.terminate();server.wait(timeout=5)
  for row in rpc(app,'list'):
   if not row['exited']:rpc(app,'kill',id=row['id'])
  os.kill(int((location(app)/'holder.pid').read_text()),signal.SIGTERM)
 sys.exit(result.returncode)
