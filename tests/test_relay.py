"""Live relay acceptance: real PTYs and sockets, no agents or default Vault."""
import base64, json, os, signal, socket, subprocess, sys, tempfile, time, shutil, unittest, urllib.error, urllib.request
from pathlib import Path
sys.dont_write_bytecode=True
REPO=Path(__file__).resolve().parents[1];sys.path.insert(0,str(REPO/'backend'))
from common import connection, HOME, identity, journal, location, rpc, start, exclude_private
class Relay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']);cls.root=Path(cls.temp.name);(cls.root/'index.html').write_text('<button>fixture</button>');cls.server=None;cls.start()
    @classmethod
    def start(cls):
        cls.server,cls.info=start(cls.root,'--node','app.iframe')
    @classmethod
    def tearDownClass(cls):
        cls.server.terminate();cls.server.wait(timeout=5)
        for row in rpc(cls.root,'list'):
            if not row['exited']:
                try:rpc(cls.root,'kill',id=row['id'])
                except RuntimeError:pass
        os.kill(int((location(cls.root)/'holder.pid').read_text()),signal.SIGTERM)
        cls.temp.cleanup()
    def request(self,route,body=None,method=None,headers=None):
        headers={'Authorization':'Bearer '+self.info['token'],**(headers or {})};data=json.dumps(body).encode() if body is not None else None
        return urllib.request.urlopen(urllib.request.Request(self.info['base']+route,data,headers,method=method),timeout=10)
    def test_connection_program_names(self):
        script=self.root/'opencode.js';script.write_text('setInterval(()=>{},1000)')
        id=rpc(self.root,'create',argv=['node',str(script)],external=True)
        try:
            for _ in range(100):
                row=next(r for r in rpc(self.root,'list') if r['id']==id)
                if row['program'] and row['program']['name']=='opencode':break
                time.sleep(.03)
            self.assertTrue(row['active']);self.assertTrue(row['external']);self.assertEqual(row['program']['name'],'opencode')
        finally:rpc(self.root,'kill',id=id)
    def test_01_auth_origin_and_escape(self):
        for route,headers,status in [('/workspaces',{'Authorization':'Bearer bad'},401),('/workspaces',{'Origin':'https://bad.example'},403),('/w/project/file?path=../outside',{},403),('/w/project/file?path=/etc/passwd',{},403)]:
            with self.assertRaises(urllib.error.HTTPError) as error:self.request(route,headers=headers)
            self.assertEqual(error.exception.code,status)
        (self.root/'escape').symlink_to('/etc/passwd')
        with self.assertRaises(urllib.error.HTTPError) as error:self.request('/w/project/file?path=escape')
        self.assertEqual(error.exception.code,403)
    def test_02_node_files_and_isolated_renderer(self):
        tree=json.load(self.request('/w/project/tree'));self.assertEqual(tree['entries'][0]['name'],'app.iframe')
        self.assertIn(b'render\tapp\tapp\tindex.html',self.request('/w/project/file?path=app.iframe/exports.txt').read())
        data=self.request('/w/project/file?path=app.iframe/index.html').read();self.assertNotIn(self.info['token'].encode(),data)
        preview=urllib.request.urlopen(self.info['preview']+'/project/app.iframe/index.html');self.assertIn(b'fixture',preview.read())
        with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(self.info['preview']+'/workspaces')
        self.request('/w/project/file?path=note.txt',method='PUT',body='changed').close();self.assertEqual((self.root/'note.txt').read_text(),'"changed"')
    def wait_file(self,path):
        for _ in range(100):
            if path.exists(): return json.loads(path.read_text())
            time.sleep(.03)
        self.fail('PTY effect did not arrive')
    def test_03_suppression_login_and_bracketed_prompt(self):
        sessions=Path.home()/'.codex/sessions';before={str(p) for p in sessions.rglob('*')} if sessions.exists() else set()
        fake=self.root/'fake.py';fake.write_text('import json,os,sys\nfrom pathlib import Path\nprint("\\x1b[?2004hready",flush=True)\nPath("env.json").write_text(json.dumps({k:os.environ.get(k) for k in ("CODEX_HOME","CLAUDE_CONFIG_DIR","XDG_DATA_HOME")}))\nline=input()\nPath("received.json").write_text(json.dumps(line))\n')
        id=rpc(self.root,'create',suppress=True,argv=[sys.executable,str(fake)]);env=self.wait_file(self.root/'env.json')
        from completion import RULE
        for name in ('AGENTS.md','CLAUDE.md'):self.assertEqual((Path(env['CODEX_HOME'])/name).read_text(),RULE+'\n')
        home = Path(env['CODEX_HOME'])
        self.assertTrue(all(v.startswith(str(self.root / '.alembic/agent-home')) for v in env.values()))
        self.assertTrue((home / 'auth.json').is_symlink())
        self.assertEqual((home / 'auth.json').resolve(), (Path.home() / '.codex/auth.json').resolve())
        self.assertTrue((home / 'auth.json').exists())
        text='Node app.iframe; exact prompt (details: context.json)';rpc(self.root,'prompt',id=id,text=text)
        self.assertEqual(self.wait_file(self.root/'received.json'),'\x1b[200~'+text+'\x1b[201~')
        self.assertEqual(before,{str(p) for p in sessions.rglob('*')} if sessions.exists() else set())
    def test_04_al_attach_agent_already_running_and_restart(self):
        fake=self.root/'attached.py';fake.write_text('import json\nfrom pathlib import Path\nprint("already-running",flush=True)\nwhile True:\n line=input()\n Path("attached.json").write_text(json.dumps(line))\n')
        master,slave=__import__('pty').openpty()
        child=subprocess.Popen([str(REPO/'backend/al'),'--project',str(self.root),'attach','--new','--',sys.executable,str(fake)],stdin=slave,stdout=slave,stderr=slave);os.close(slave)
        try:
            for _ in range(100):
                rows=rpc(self.root,'list');row=next((r for r in rows if r['agent']==Path(sys.executable).name and not r['exited']),None)
                if row and b'already-running' in base64.b64decode(rpc(self.root,'read',id=row['id'])['data']):break
                time.sleep(.03)
            self.assertIsNotNone(row);self.assertFalse(row['suppress']);self.assertTrue(rpc(self.root,'active',id=row['id']))
            # Detach the actual terminal view; its already-running child remains in the holder.
            os.write(master,b'\x1d');child.wait(timeout=5)
            self.server.terminate();self.server.wait(timeout=5);type(self).start()
            rpc(self.root,'prompt',id=row['id'],text='attached survives');self.assertIn('attached survives',self.wait_file(self.root/'attached.json'))
        finally:
            if child.poll() is None: child.terminate();child.wait(timeout=5)
            os.close(master)
    def test_05_git_routes_and_real_restore(self):
        env=dict(os.environ,GIT_AUTHOR_NAME='fixture',GIT_AUTHOR_EMAIL='fixture@example.invalid',GIT_COMMITTER_NAME='fixture',GIT_COMMITTER_EMAIL='fixture@example.invalid')
        (self.root/'binary.bin').write_bytes(b'\x00\xff\x80binary')
        for argv in [('init',),('add','index.html','binary.bin'),('commit','-m','initial')]:subprocess.run(['git','-C',str(self.root),*argv],env=env,check=True,capture_output=True)
        log=json.load(self.request('/w/project/log'));self.assertEqual(log[0]['message'],'initial');revision=log[0]['commit'];(self.root/'index.html').write_text('edit')
        (self.root/'binary.bin').unlink();self.assertEqual(self.request('/w/project/file?path=binary.bin&at='+revision).read(),b'\x00\xff\x80binary');self.assertIn('binary.bin',[r['name'] for r in json.load(self.request('/w/project/tree?at='+revision))['entries']])
        self.assertIn('index.html',[r['path'] for r in json.load(self.request('/w/project/diff?a='+revision))])
        self.assertTrue(json.load(self.request('/w/project/graph'))['nodes']);self.assertTrue(json.load(self.request('/w/project/trace?path=index.html'))['steps'])
        self.request('/w/project/restore',dict(at=revision)).close();self.assertIn('fixture',(self.root/'index.html').read_text())
    def test_06_log_cap(self):
        for i in range(70):journal(self.root,'test',dict(index=i,text='x'*14000))
        paths=list((self.root/'.alembic/logs').glob('journal.jsonl*'))
        self.assertLessEqual(sum(p.stat().st_size for p in paths),1048576)
        for path in paths:
            for line in path.read_text().splitlines():json.loads(line)
    def test_09_embed_apps_and_project_folders(self):
        root=self.root/'one-command';root.mkdir();(root/'index.html').write_text('<button>one command</button>')
        (root/'assets').mkdir(); (root/'assets/fixture.js').write_text('source-asset')
        project=self.root/'nodes';project.mkdir();(project/'model.i3d').mkdir()
        env=dict(os.environ,AL_ASSETS=os.environ.get('AL_ASSETS',str(REPO/'frontend/dist')))
        targets=[str(root),str(root/'index.html'),self.info['preview']+'/project/app.iframe/index.html',str(project)]
        for target in targets:
            with self.subTest(target=target):
                subprocess.run([str(REPO/'backend/al'),'embed',target],env=env,check=True,capture_output=True,timeout=30)
                active=Path((HOME/'relay/current').read_text());folder=location(active);info=connection(active)
                try:
                    headers={'Authorization':'Bearer '+info['token']}
                    def read(path):return urllib.request.urlopen(urllib.request.Request(info['base']+path,headers=headers))
                    with read('/') as response:self.assertIn(b'<html',response.read())
                    tree=json.load(read('/w/project/tree'))['entries']
                    expected = ['.alembic', 'model.i3d'] if target == str(project) else [info['node']]
                    self.assertEqual([row['name'] for row in tree], expected)
                    if target == str(root / 'index.html'):
                        self.assertNotEqual(active, root)
                        route = '/w/project/file?path=' + info['node'] + '/assets/fixture.js'
                        self.assertEqual(read(route).read(), b'source-asset')
                    self.assertEqual(bool(info['node']),target!=str(project))
                    if info['node']:
                        with urllib.request.urlopen(info['preview']+'/project/'+info['node']+'/index.html') as response:self.assertIn(b'<button>',response.read())
                finally:
                    subprocess.run([str(REPO/'backend/al'),'stop'],env=env,check=True,capture_output=True)
                    for row in rpc(active,'list'):
                        if not row['exited']:rpc(active,'kill',id=row['id'])
                    os.kill(int((folder/'holder.pid').read_text()),signal.SIGTERM)
    def test_08_app_url_and_waiter(self):
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
        import functools, threading
        server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=str(self.root)))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        node=self.root/'remote.iframe';node.mkdir();url=f'http://localhost:{server.server_port}/'
        (node/'exports.txt').write_text('exports-index\t1\nrender\tapp\tapp\t'+url+'\n')
        from urllib.parse import quote
        path='remote.iframe/__remote__/'+quote(url,safe="~()*!.'-_")+'/index.html'
        try:
            self.assertIn(b'fixture',self.request('/w/project/file?'+__import__('urllib.parse',fromlist=['urlencode']).urlencode(dict(path=path))).read())
        finally:server.shutdown();server.server_close()
        with self.assertRaises(urllib.error.HTTPError) as error:self.request('/w/project/file?'+__import__('urllib.parse',fromlist=['urlencode']).urlencode(dict(path=path)))
        self.assertIn('refused',error.exception.read().decode().lower())
        for once in (False,True):
            child=subprocess.Popen([str(REPO/'backend/al'),'--project',str(self.root),'wait','--name','receiver',*(['--once'] if once else [])],stdout=subprocess.PIPE,text=True)
            try:
                for _ in range(100):
                    row=next((r for r in rpc(self.root,'list') if r['pid']==child.pid),None)
                    if row:break
                    time.sleep(.01)
                self.assertTrue(row['active']);self.assertTrue(row['external']);self.assertEqual(row['program']['name'],'receiver')
                from completion import RULE
                self.assertEqual(child.stdout.readline().strip(), RULE)
                ticks=lambda:Path(f'/proc/{child.pid}/stat').read_text().split()[13:15]
                before=ticks();time.sleep(.25);self.assertEqual(ticks(),before)
                at=time.monotonic();rpc(self.root,'prompt',id=row['id'],text='# exact prompt (details: context.json)')
                self.assertEqual(child.stdout.readline(),'# exact prompt (details: context.json)\n');self.assertLess(time.monotonic()-at,.2)
                if not once:
                    os.kill(child.pid,signal.SIGSTOP)
                    try:rpc(self.root,'prompt',id=row['id'],text='received while not waiting')
                    finally:os.kill(child.pid,signal.SIGCONT)
                    self.assertEqual(child.stdout.readline(),'received while not waiting\n')
                if once:
                    with self.assertRaises(RuntimeError):rpc(self.root,'prompt',id=row['id'],text='must fail')
                    child.wait(timeout=1)
            finally:
                if child.poll() is None:child.kill();child.wait(timeout=1)
                child.stdout.close()
            for _ in range(100):
                if not any(r['pid']==child.pid for r in rpc(self.root,'list')):break
                time.sleep(.01)
            self.assertFalse(any(r['pid']==child.pid for r in rpc(self.root,'list')))
    def test_10_no_servable_secret_or_filesystem_proxy(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading
        class Development(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                # A dev server with a deliberately broad allowed root would leak any disk token.
                self.send_response(200); self.end_headers()
                self.wfile.write((location(self.root)/'server.json').read_bytes()
                    if self.path.startswith('/@fs/') else b'app-source')
        Development.root=self.root
        upstream=ThreadingHTTPServer(('127.0.0.1',0),Development)
        threading.Thread(target=upstream.serve_forever,daemon=True).start()
        root=self.root/'dev';root.mkdir();(root/'index.html').write_text('dev')
        child,info=start(root,'--node','dev.iframe','--upstream',f'http://127.0.0.1:{upstream.server_port}')
        try:
            self.assertNotIn('token',json.loads((location(root)/'server.json').read_text()))
            self.assertFalse((location(root)/'url').exists())
            for base in (info['base'],info['preview']):
                for route in ('/@fs/'+str(location(root)/'server.json'),'/@fs//etc/passwd',
                    '/%40fs/etc/passwd','/%2540fs/etc/passwd','/a/%2e%2e/@fs/etc/passwd',
                    '/%5c@fs/etc/passwd','/server.json','/project/dev.iframe/%2e%2e/server.json'):
                    with self.subTest(base=base,route=route):
                        request=urllib.request.Request(base+route,headers={'Origin':info['preview']})
                        with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
                        self.assertIn(error.exception.code,(403,404))
                        self.assertNotIn(info['token'].encode(),error.exception.read())
            for origin in ('https://wrong.example',info['preview']):
                request=urllib.request.Request(info['preview']+'/__al/message',b'{}',{'Origin':origin})
                with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
                self.assertEqual(error.exception.code,403)
            self.assertEqual(urllib.request.urlopen(info['preview']+'/').read(),b'app-source')
            headers={'Authorization':'Bearer '+info['token']}
            self.assertEqual(json.load(urllib.request.urlopen(urllib.request.Request(info['base']+'/w/project/tree?path=dev.iframe/@vite',headers=headers)))['entries'][0]['name'],'client.js')
            self.assertEqual(urllib.request.urlopen(urllib.request.Request(info['base']+'/w/project/file?path=dev.iframe/@vite/client.js',headers=headers)).read(),b'app-source')
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(urllib.request.Request(info['base']+'/w/project/file?path=dev.iframe/@fs/etc/passwd',headers=headers))
            self.assertEqual(error.exception.code,403)
        finally:
            child.terminate();child.wait(timeout=5);upstream.shutdown();upstream.server_close()
            os.kill(int((location(root)/'holder.pid').read_text()),signal.SIGTERM)
    def test_11_aborted_malformed_requests_bound_all_logs(self):
        from urllib.parse import urlsplit
        address=urlsplit(self.info['base']);deadline=time.monotonic()+15
        for _ in range(800):
            self.assertLess(time.monotonic(),deadline,'Aborted-request flood did not drain')
            with socket.create_connection((address.hostname,address.port),timeout=3) as sock:
                sock.sendall(b'GET /workspaces HTTP/1.1\r\nHost: '+address.netloc.encode()+b'\r\n\r\n')
        self.assertEqual(json.load(self.request('/workspaces'))[0]['id'],'project')
        self.assertLessEqual((self.root/'.alembic/logs/server.log').stat().st_size,524288)
        for p in (self.root/'.alembic/logs').glob('journal.jsonl*'):
            self.assertLessEqual(p.stat().st_size,524288)
    def test_12_holder_restart_and_websocket_close(self):
        os.kill(int((location(self.root)/'holder.pid').read_text()),signal.SIGTERM)
        time.sleep(.1)
        reply=json.load(self.request('/vms/local/shell/ticket',{}))
        self.assertTrue(reply['ticket'])
        self.assertIn(reply['id'],[row['id'] for row in rpc(self.root,'list')])
        from urllib.parse import urlsplit
        address=urlsplit(self.info['base'])
        with socket.create_connection((address.hostname,address.port),timeout=3) as sock:
            sock.sendall(('GET /vms/local/shell/ws?ticket='+reply['ticket']+' HTTP/1.1\r\nHost: '+
                address.netloc+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'+
                'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
            response=b''
            while b'\r\n\r\n' not in response: response+=sock.recv(1)
            self.assertIn(b'101 Switching Protocols',response)
            payload=b'\0{"resize":null}'
            sock.sendall(bytes([0x82,0x80|len(payload)])+b'\0'*4+payload)
            while True:
                head=sock.recv(2)
                self.assertEqual(len(head),2)
                size=head[1]&127
                if size==126: size=int.from_bytes(sock.recv(2),'big')
                data=b''
                while len(data)<size: data+=sock.recv(size-len(data))
                self.assertNotIn(b'HTTP/1.1 400',data)
                if head[0]&15==8:
                    self.assertEqual(int.from_bytes(data[:2],'big'),1007);break
    def test_07_mock_uses_same_routes_without_live_sessions(self):
        from peers import Peers
        peer=Peers(REPO/'tests/states/iframe-success.json');self.assertEqual(peer.session('create'),'mock');self.assertEqual(peer.session('list')[0]['id'],'mock')
        peer.session('input',data=base64.b64encode(b'echo fixture').decode());self.assertIn(b'echo fixture',base64.b64decode(peer.session('read',cursor=0)['data']))

    def test_13_project_completion_receipt_without_relay_discovery(self):
        details=self.root/'.alembic/selections/canvas/s1-00000000-0000-4000-8000-000000000001.json'
        details.parent.mkdir(parents=True,exist_ok=True)
        details.write_text(json.dumps(dict(version=1)))
        env=dict(os.environ,AL_HOME=str(self.root/'no-server-home'))
        def done(path):
            return subprocess.run([str(REPO/'backend/al'),'done',str(path)],cwd=self.root,env=env,capture_output=True)
        for _ in range(2):self.assertEqual(done(details).returncode,0)
        marker=details.with_suffix('.done');self.assertEqual(marker.read_text(),'done\n')
        self.assertFalse(details.exists());self.assertFalse((self.root/'no-server-home').exists())
        for _ in range(2):
            self.request('/w/project/file?path='+str(marker.relative_to(self.root)),method='DELETE').close()
        self.assertFalse(marker.exists());self.assertEqual(done(details).returncode,0);self.assertFalse(marker.exists())
        for name in ['bad.json','.alembic/selections/canvas/s1-invalid.json']:
            with self.subTest(name=name):
                result=done(name);self.assertNotEqual(result.returncode,0);self.assertIn(b'Expected',result.stderr)

    def test_14_private_files_and_listings(self):
        from urllib.parse import quote
        for folder in ('agent-home', 'logs', '.cache'):
            private = self.root / '.alembic' / folder
            private.mkdir(exist_ok=True)
            (private / 'secret.txt').write_text('private-transcript')
            alias = self.root / ('alias-' + folder)
            alias.symlink_to(private, target_is_directory=True)
            (self.root / ('leaf-' + folder)).symlink_to(private / 'secret.txt')
            paths = ['.alembic/' + folder, '.alembic/' + folder + '/secret.txt',
                'alias-' + folder, 'alias-' + folder + '/secret.txt', 'leaf-' + folder]
            paths += ['.ALEMBIC/' + folder.upper() + '/secret.txt']
            if folder == 'agent-home':
                paths += ['.alembic/agent-home/auth.json', '.alembic/agent-home/.credentials.json']
            for name in paths:
                for encoded in (name, quote(name, safe=''), name.replace('.alembic', '%2ealembic'),
                    quote(quote(name, safe=''), safe='')):
                    for prefix in ('', 'app.iframe/'):
                        for op in ('file', 'tree'):
                            with self.subTest(op=op, name=prefix + encoded):
                                with self.assertRaises(urllib.error.HTTPError) as error:
                                    self.request('/w/project/' + op + '?path=' + prefix + encoded)
                                self.assertIn(error.exception.code, (403, 404))
                        with self.assertRaises(urllib.error.HTTPError) as error:
                            urllib.request.urlopen(self.info['preview'] + '/project/' + prefix + encoded)
                        self.assertIn(error.exception.code, (403, 404))
            for method in ('PUT', 'DELETE'):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    self.request('/w/project/file?path=.alembic/' + folder + '/secret.txt', method=method)
                self.assertEqual(error.exception.code, 403)
            self.assertEqual((private / 'secret.txt').read_text(), 'private-transcript')
        for prefix in ('', 'app.iframe/'):
            entries = json.load(self.request('/w/project/tree?path=' + prefix + '.alembic'))['entries']
            self.assertFalse({'agent-home', 'logs', '.cache'} & {r['name'] for r in entries})
        entries = json.load(self.request('/w/project/tree?path=app.iframe'))['entries']
        self.assertFalse(any(r['name'].startswith(('alias-', 'leaf-')) for r in entries))
        for name in ('selections/probe.json', 'crops/probe.png'):
            path = '.alembic/' + name
            self.request('/w/project/file?path=' + path, body='public-context', method='PUT').close()
            self.assertIn(b'public-context', self.request('/w/project/file?path=' + path).read())
        rpc(self.root, 'prompt', text='echo private-transcript')
        log = json.load(self.request('/al/log'))
        self.assertFalse(any(row['kind'].startswith('session.') and row['kind'] != 'session.created' for row in log))

        def git_object(command, text):
            return subprocess.check_output(['git', '-C', str(self.root), *command], input=text.encode()).decode().strip()
        blob = git_object(['hash-object', '-w', '--stdin'], 'private-transcript')
        tree = git_object(['mktree'], f'100644 blob {blob}\tsecret.txt\n')
        internal = git_object(['mktree'], ''.join(f'040000 tree {tree}\t{n}\n'
            for n in ('agent-home', 'logs', '.cache')))
        revision = git_object(['mktree'], f'040000 tree {internal}\t.alembic\n')
        entries = json.load(self.request('/w/project/tree?path=.alembic&at=' + revision))['entries']
        self.assertEqual(entries, [], 'Git snapshots must hide private directories too')

    def test_15_migration_live_holder_temp_and_exclude(self):
        from sessions import ensure
        root = self.root / 'migration'; root.mkdir()
        old = HOME / 'agent-home' / identity(root)
        (old / 'sessions').mkdir(parents=True)
        (old / 'sessions/history.jsonl').write_text('retained-history')
        unrelated = HOME / 'projects/untouched'; unrelated.mkdir(parents=True, exist_ok=True)
        (unrelated / 'sentinel').write_text('Vault')
        ensure(root)
        try:
            home = root / '.alembic/agent-home'
            self.assertEqual((home / 'sessions/history.jsonl').read_text(), 'retained-history')
            self.assertFalse(old.exists())
            temp = root / '.alembic/.cache/tmp/stale'; temp.write_text('disposable')
            ensure(root); self.assertTrue(temp.exists(), 'Live holder keeps open temp files')
            old.mkdir(); (old / 'live-history').write_text('do not move')
            with self.assertRaisesRegex(ValueError, 'in use'): ensure(root)
            self.assertTrue((old / 'live-history').exists())
            (old / 'live-history').unlink(); old.rmdir()
            os.kill(int((location(root) / 'holder.pid').read_text()), signal.SIGTERM)
            time.sleep(.1); ensure(root)
            self.assertFalse(temp.exists())
            self.assertEqual((home / 'sessions/history.jsonl').read_text(), 'retained-history')
            self.assertEqual((unrelated / 'sentinel').read_text(), 'Vault')
        finally:
            os.kill(int((location(root) / 'holder.pid').read_text()), signal.SIGTERM)
        subprocess.run(['git', '-C', str(root), 'init'], check=True, capture_output=True)
        exclude_private(root)
        exclude = root / '.git/info/exclude'; before = exclude.read_text()
        self.assertIn('/.alembic/', before)
        exclude_private(root); self.assertEqual(exclude.read_text(), before)
        self.assertFalse((root / '.gitignore').exists())
        exclude.write_text(''); (root / '.gitignore').write_text('.alembic/\n')
        exclude_private(root); self.assertEqual(exclude.read_text(), '')
        self.assertEqual((root / '.gitignore').read_text(), '.alembic/\n')
        blocked = self.root / 'blocked'; blocked.mkdir(); (blocked / '.alembic').write_text('not a directory')
        result = subprocess.run([str(REPO / 'backend/al'), 'embed', str(blocked)], capture_output=True,
            env=dict(os.environ, AL_ASSETS=str(REPO / 'frontend/dist')))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'Cannot write project storage', result.stderr)
        linked = self.root / 'linked'; linked.mkdir(); (linked / '.alembic').symlink_to(root / '.alembic')
        with self.assertRaisesRegex(RuntimeError, 'must not use symlinks'): ensure(linked)

if __name__=='__main__':unittest.main()
