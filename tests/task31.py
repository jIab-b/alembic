"""Disposable real-route Windows checks; caller supplies TMPDIR, AL_HOME and AL_ASSETS."""
import functools, http.server, importlib.machinery, json, os, shutil, signal, sys, tempfile, threading, time, subprocess
from pathlib import Path
repo=Path(__file__).resolve().parents[1];sys.path.insert(0,str(repo/'backend'))
from common import launch_url, location, rpc, start, connection
runner=importlib.machinery.SourceFileLoader('windows_run',str(repo/'tests/windows-run.py')).load_module()
case=sys.argv[1]
fixtures=Path(os.environ.get('ALEMBIC_FIXTURE_ROOT', repo/'tests/mock'))
os.environ['PATH']=str(repo/'tests/fixtures')+os.pathsep+os.environ['PATH']
with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as directory:
    root=Path(directory)/'project';shutil.copytree(fixtures,root,ignore=lambda directory,names:
        set(names)-{'audio','i2d','i3d','iframe','invalid','skills','demos',
            'stub.i2d','broken.i2d','unsupported.i3d'} if Path(directory)==fixtures else {'.alembic'})
    shutil.copy2(repo/'tests/fixtures/codex',root/'codex')
    if case!='playback':
        for source in ['i3d/box.i3d','i3d/model.i3d','i2d/flat.i2d']:shutil.copytree(root/source,root/Path(source).name)
    class Page(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
    app=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Page,directory=str(root/'iframe/server.iframe')))
    threading.Thread(target=app.serve_forever,daemon=True).start()
    (root/'iframe/server.iframe/exports.txt').write_text(f'exports-index\t1\nrender\tapp\tapp\thttp://localhost:{app.server_port}\n')
    if case=='embed':
        shutil.copy2(repo/'tests/fixtures/embed.html',root/'index.html');shutil.copy2(repo/'tests/fixtures/embed-agent',root/'codex')
    relay=None
    if case=='completion':
        subprocess.run([str(repo/'backend/al'),'embed',str(root)],check=True,capture_output=True)
        info=connection(root)
    else:relay,info=start(root,*(['--node','app.iframe'] if case=='embed' else []))
    url=Path(directory)/'url';url.write_text(launch_url(info))
    try:
        if case=='connections':
            external=root/'external';external.mkdir();shutil.copy2(root/'codex',external/'codex')
            def attach():
                for _ in range(300):
                    if any(r['active'] for r in rpc(root,'list')):break
                    time.sleep(.1)
                time.sleep(2);rpc(root,'create',argv=['bash','-c','cd external && exec ./codex'],suppress=False,external=True)
            threading.Thread(target=attach,daemon=True).start()
        extra=dict(ALEMBIC_CLI=str(repo/'backend/al'),ALEMBIC_MOCK=runner.windows(root))
        if os.environ.get('ALEMBIC_GROUP'): extra['ALEMBIC_GROUP']=os.environ['ALEMBIC_GROUP']
        if case=='completion' and os.environ.get('ALEMBIC_COMPLETION_NODE'):
            extra['ALEMBIC_COMPLETION_NODE']=os.environ['ALEMBIC_COMPLETION_NODE']
        if case in ('ports','demos','directions'):
            extra['ALEMBIC_CHECK']=runner.windows(repo/('tests/'+case+'-browser.mjs'))
        if case in ('task31','waiter','completion'):
            extra['ALEMBIC_CHECK']=runner.windows(repo/'tests/task31-browser.mjs')
        phases=['seed','resume'] if os.environ.get('ALEMBIC_RESTART_CHECK') else ['']
        for phase in phases:
            if phase:extra['ALEMBIC_RESTART_PHASE']=phase
            out=Path(os.environ['TMPDIR'])/('final-'+case+phase+os.environ.get('ALEMBIC_GROUP',''))
            result=runner.run(url,out,case,extra)
            print(result.stdout);print(result.stderr,file=sys.stderr)
            if result.returncode:sys.exit(result.returncode)
            if phase=='seed':
                subprocess.run([str(repo/'backend/al'),'--project',str(root),'stop'],check=True,capture_output=True)
                subprocess.run([str(repo/'backend/al'),'embed',str(root)],check=True,capture_output=True)
                info=connection(root);url.write_text(launch_url(info))
    finally:
        for row in rpc(root,'list'):
            if not row['exited']:
                try:rpc(root,'kill',id=row['id'])
                except RuntimeError:pass
        if relay:relay.terminate();relay.wait(timeout=5)
        else:os.kill(info['pid'],signal.SIGTERM)
        os.kill(int((location(root)/'holder.pid').read_text()),signal.SIGTERM)
        app.shutdown();app.server_close()
