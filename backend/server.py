"""Single-project node.js routes, with an API-free renderer origin. No Vault state."""
import argparse, base64, hashlib, http.client, json, mimetypes, os, secrets, select, signal, socket, subprocess, sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlencode, urlsplit, urljoin
from common import HOME, REPO, Wire, app_rows, confined, journal, location, rpc, upgrade, BoundedLog
from common import html_prefix, request, start, connection, stop, project_dir

def git(root, *args, binary=False):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, timeout=15)
    if result.returncode:
        raise ValueError(result.stderr.decode(errors='replace').strip())
    return result.stdout if binary else result.stdout.decode(errors='replace')

def serve(root, port=0, node='', upstream='', state='', allowed='', self_app=False, entry='index.html',
        replace=False, source=''):
    assets = Path(os.environ.get('AL_ASSETS', REPO / 'frontend/dist')).resolve()
    root = Path(root).resolve()
    source = Path(source).resolve() if source else root
    vite_env = REPO/'frontend/node_modules/vite/dist/client/env.mjs'
    vite_modules = {'/@vite/client.js':'/@vite/client','/@vite/env.js':'/@fs'+str(vite_env)}
    folder = location(root)
    previous = connection(root) if replace else None
    if previous:
        port = urlsplit(previous['base']).port
        stop(previous['pid'], str(REPO / 'backend/server.py'))
    token = previous['token'] if previous else 'mock' if state else secrets.token_urlsafe(32)
    tickets = {}
    sys.stdout = sys.stderr = BoundedLog(project_dir(root, 'logs') / 'server.log')
    from peers import Peers
    peers = Peers(state) if state else None
    mock = peers.state if peers else None

    def session(op, **body):
        if peers:
            return peers.session(op, **body)
        from sessions import ensure
        ensure(root)
        return rpc(root, op, **body)
    session('list')
    authored = app_rows(root) if not peers else []
    if authored:
        entry = next((row[3] for row in authored if len(row) == 4 and row[0] == 'render' and (row[2] == 'app')))

    def meta():
        states = sorted((REPO / 'tests/states').glob('*.json')) if mock or self_app else []
        return (dict(renders=[row[1] for row in authored if len(row) == 4 and row[0] == 'render'] or ['app'],
            scenarios=[p.stem for p in states], state=mock['name'] if mock else 'iframe-success' if self_app else
            'inspect', mock=bool(mock or self_app), mode=mock.get('replies', {}).get('render', {}).get('mode',
            'success') if mock else 'success'))

    def path(name):
        return (confined(root, '' if node and name == node else name.removeprefix(node + '/') if node and
            name.startswith(node + '/') else name))

    def file(name):
        path(name)  # Check every route, including virtual and iframe resources.
        if '/__remote__/' in name:
            owner, remote = name.split('/__remote__/', 1)
            encoded, resource = remote.split('/', 1)
            url = unquote(encoded)
            if not any(len(row)==4 and row[0]=='render' and row[2:] == ['app',url] for row in app_rows(path(owner))):
                raise PermissionError('Undeclared app URL')
            target = urlsplit(url if resource=='index.html' else urljoin(url, resource))
            if target.scheme != 'http' or target.username or target.password: raise ValueError('Only HTTP app URLs are supported')
            remote = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=8)
            try:
                remote.request('GET', target.path + ('?'+target.query if target.query else ''))
                response = remote.getresponse()
                if response.status>=400: raise ValueError('App server returned '+str(response.status))
                return response.read()
            finally: remote.close()
        if node and name == '.alembic/tree.txt':
            return json.dumps(dict(version=1, hidden=[node + '/exports.txt', node + '/playbacks.txt'])).encode()
        if (authored and node and (name in [node + '/' + f for f in ('.node.txt', 'exports.txt', 'playbacks.txt')]) and
            (root / name.split('/')[-1]).is_file()):
            return (root / name.split('/')[-1]).read_bytes()
        if node and name == node + '/exports.txt':
            return ('exports-index\t1\nrender\tapp\tapp\t' + entry + '\ninteraction\tapp\tio_lock\ttrue\n').encode()
        if node and name == node + '/playbacks.txt':
            return (('playbacks-index\t2\n' + ''.join(('scenario\t' + id + '\t' + id + '\tapp\tunknown\tnone\t' +
                json.dumps(json.dumps(dict(state=id))) + '\n' for id in meta()['scenarios']))).encode())
        if node and name == node + '/.node.txt':
            return json.dumps(dict(format='alembic.node', version=1, entry=entry, dependencies={})).encode()
        if peers:
            data = peers.read(name, node)
        elif self_app and name.startswith(node+'/') and confined(assets,name[len(node)+1:]).is_file():
            # The self-embedded app is the built distribution, including its assets.
            data=confined(assets,name[len(node)+1:]).read_bytes()
        elif node and name == node + '/' + entry and upstream:
            target = urlsplit(upstream)
            connection = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=8)
            connection.request('GET', target.path or '/')
            response = connection.getresponse()
            if response.status >= 400:
                raise ValueError('App backend returned ' + str(response.status))
            data = response.read()
            connection.close()
            data=html_prefix(data.replace(b'"/@vite/client"',b'"/@vite/client.js"'),b'<base href="'+preview_origin.encode()+b'/">')
        else:
            target = path(name)
            data = (target if target.exists() else confined(source, str(target.relative_to(root)))).read_bytes()
        if peers and name.endswith('/index.html') or (node and name == node + '/' + entry):
            data += b'<script>window.__alApp=' + json.dumps(meta() | dict(threeD=name.split('/')[-2].endswith(
                '.i3d'))).encode() + b'</script><script type="module" src="' + preview_origin.encode(
                ) + b'/__al/app.js"></script>'
        if self_app and name == node + '/' + entry:
            data=html_prefix(data,b'<script>location.hash='+json.dumps(mock_fragment).encode()+b'</script>')
        return data

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        rbufsize = 0

        def log_message(self, *_):
            pass

        def respond(self, body, status=200, kind='application/json', headers=None):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            if self.path.startswith(('/w/', '/vms/')) and 'Authorization' in self.headers:
                journal(root, 'reply', dict(route=urlsplit(self.path).path, status=status, body={k: v for k,
                    v in body.items() if k not in ('ticket', 'token')} if isinstance(body, dict) else body if
                    not isinstance(body, bytes) else {'bytes': len(body)}))
            if status>=400:
                self.close_connection=True
                headers={**(headers or {}),'Connection':'close'}
            self.send_response(status)
            for key, value in dict({'Content-Type': kind, 'Content-Length': str(len(data)), 'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
                'X-Content-Type-Options': 'nosniff'}, **headers or {}).items():
                self.send_header(key, value)
            if allowed and self.headers.get('Origin') == allowed:
                self.send_header('Access-Control-Allow-Origin', allowed)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)

        def do_OPTIONS(self):
            self.respond({}, 200 if allowed and self.headers.get('Origin') == allowed else 403, headers={
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'})

        def do_GET(self):
            try:
                url = urlsplit(self.path)
                route = unquote(url.path)
                query = {k: v[0] for k, v in parse_qs(url.query).items()}
                origin = self.headers.get('Origin')
                preview = self.server is renderer
                expected = preview_origin if preview else controller_origin
                if (self.headers.get('Host') not in (urlsplit(expected).netloc, urlsplit(expected).netloc.replace(
                    'localhost', '127.0.0.1'))):
                    raise PermissionError('Wrong host')
                if preview:
                    return self.preview(route)
                if origin and origin not in (controller_origin, allowed):
                    raise PermissionError('Wrong origin')
                api = route.startswith(('/w/', '/vms', '/workspaces', '/al/'))
                if not api:
                    if self.command not in ('GET', 'HEAD'):
                        return self.respond({}, 405)
                    asset = confined(assets, route.lstrip('/') or 'index.html')
                    return (self.respond(asset.read_bytes(), kind=mimetypes.guess_type(str(asset))[0] or
                        'application/octet-stream'))
                if route.endswith('/ws'):
                    ticket = tickets.pop(query.get('ticket', ''), None)
                    if not ticket or ticket[1] < time.time():
                        return self.respond(dict(error='Invalid ticket'), 401)
                    return self.terminal(ticket[0])
                if not secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                    return self.respond(dict(error='Unauthorized'), 401)
                length = int(self.headers.get('Content-Length', 0))
                if not 0 <= length <= 16777216:
                    raise ValueError('Body exceeds 16 MiB')
                raw = self.rfile.read(length)
                body = json.loads(raw) if raw and self.command == 'POST' else {}
                journal(root, 'frontend', dict(method=self.command, route=route, query=query, body=body))
                if peers and route in mock.get('replies', {}):
                    reply = mock['replies'][route]
                    time.sleep(min(reply.get('delay', 0) / 1000, 15))
                    return self.respond(reply.get('body'), reply.get('status', 200))
                metadata = {'/workspaces':[dict(id='project', name=root.name, path=str(root))],
                    '/vms':[dict(id='local', workspace='project')]}
                if route in metadata:
                    return self.respond(metadata[route])
                if route == '/al/log':
                    return (self.respond([json.loads(line) for p in (project_dir(root, 'logs') / 'journal.jsonl',
                        ) if p.exists() for line in p.read_text().splitlines() if json.loads(line).get('kind') not in
                            ('session.output', 'session.input', 'session.prompt')]))
                if route == '/al/state' and (mock or self_app):
                    return self.state(body)
                if route.startswith('/w/project/'):
                    op = route[11:]
                    name = query.get('path', '')
                    target = path(name)
                    if mock and op in mock.get('replies', {}):
                        reply = mock['replies'][op]
                        time.sleep(min(reply.get('delay', 0) / 1000, 15))
                        return self.respond(reply.get('body'), reply.get('status', 200))
                    if op == 'file':
                        if (self.command == 'DELETE' and name.endswith('.done')
                            and name.startswith('.alembic/selections/')):
                            target.unlink(missing_ok=True)
                            return self.respond({})
                        if self.command == 'PUT' and peers:
                            mock['tree'][name] = raw.decode()
                            return self.respond({})
                        if self.command == 'PUT':
                            target.parent.mkdir(parents=True, exist_ok=True)
                            target.write_bytes(raw)
                            journal(root, 'file.changed', dict(path=name))
                            return self.respond({})
                        if upstream and node and name.startswith(node+'/') and query.get('at','live') == 'live' and name[len(node)+1:] not in (entry,'.node.txt','exports.txt','playbacks.txt'):
                            self.path = '/' + name[len(node)+1:]
                            return self.proxy(upstream)
                        data = file(name) if query.get('at', 'live') == 'live' else git(root, 'show', revision(query[
                            'at']) + ':' + str(target.relative_to(root)), binary=True)
                        return (self.respond(data, kind=mimetypes.guess_type(name)[0] or 'application/octet-stream',
                            headers={'ETag': '"' + hashlib.sha256(data).hexdigest() + '"'}))
                    if op == 'tree' and query.get('at', 'live') != 'live':
                        ref = revision(query['at']) + (':' + str(target.relative_to(root)) if target != root else '')
                        entries = []
                        for row in git(root, 'ls-tree', '-zl', ref).strip('\x00').split('\x00'):
                            if not row:
                                continue
                            fields, child = row.split('\t', 1)
                            try: path((name + '/' if name else '') + child)
                            except PermissionError: continue
                            mode, kind, hash, size = fields.split()
                            entries.append(dict(name=child, kind='dir' if kind == 'tree' else 'file', size=int(size) if
                                size != '-' else None, mode=int(mode, 8), mtime='2000-01-01T00:00:00Z', target=None))
                        return self.respond(dict(entries=entries, next=None))
                    if op == 'tree':
                        built = confined(assets, name[len(node)+1:] if name != node else '') if self_app and (name == node or name.startswith(node+'/')) else None
                        names = [node] if node and (not name) else [] if peers or (name == '.alembic' and (
                            not target.exists())) else [p.name for p in target.iterdir() if p.name != '.git'] if target.is_dir() else []
                        original = confined(source, str(target.relative_to(root))) if source != root else None
                        if original and original.is_dir() and (name or not node):
                            names += [p.name for p in original.iterdir()]
                        if built and built.is_dir():
                            names += [p.name for p in built.iterdir()]
                        if node and name == '.alembic':
                            names += ['tree.txt']
                        if node and name == node:
                            names = sorted(set(names + ['exports.txt', 'playbacks.txt', '.node.txt', entry.split('/')[
                                0]]))
                        if upstream and name.startswith(node+'/'):
                            names += [p.rsplit('/',1)[1] for p in (node+alias for alias in vite_modules) if p.rsplit('/',1)[0] == name]
                        if mock:
                            names += list({p[len(name) + bool(name):].split('/')[0] for p in mock.get('tree', {}) if
                                not name or p.startswith(name + '/')})
                        entries = []
                        for child in sorted(set(names)):
                            try:
                                p = path((name + '/' if name else '') + child)
                                if original and not p.exists(): p = confined(original, child)
                                if built and (built / child).exists(): p = confined(built, child)
                            except PermissionError:
                                continue
                            virtual = node and (not name)
                            stat = p.stat() if p.exists() else None
                            entries.append(dict(name=child, kind='dir' if virtual or p.is_dir() or (peers and any((
                                key.startswith((name + '/' if name else '') + child + '/') for key in mock[
                                'tree']))) else 'file', size=stat.st_size if stat else 0, mode=420, mtime=__import__(
                                'datetime').datetime.fromtimestamp(stat.st_mtime, __import__(
                                'datetime').timezone.utc).isoformat() if stat else '2000-01-01T00:00:00Z', target=None))
                        return self.respond(dict(entries=entries, next=None))
                    if op == 'annotate':
                        journal(root, 'annotation', body)
                        return self.respond({})
                    if op == 'services':
                        return self.respond(dict(services=[], vms=['local']))
                    if op in ('log', 'diff', 'restore', 'graph', 'trace'):
                        return (self.respond((dict(nodes=[], artifacts=[], edges=[]) if op == 'graph' else []) if
                            peers else history(op, query, body)))
                    if op in ('node-commit', 'node-saves', 'node-restore'):
                        return self.respond(dict(error='Recursive Save requires the pinned Vault backend'), 501)
                if route.startswith('/vms/local/'):
                    op = route[11:]
                    if op == 'events' and peers:
                        return self.respond(b'data: {"kind":"commit","id":1}\n\n', kind='text/event-stream')
                    if op == 'events':
                        self.send_response(200)
                        self.send_header('Content-Type', 'text/event-stream')
                        self.send_header('Connection', 'close')
                        self.end_headers()
                        last = ''
                        while True:
                            current = []
                            for base, dirs, files in os.walk(root):
                                dirs[:] = [d for d in dirs if d not in ('.git', '.alembic', 'node_modules', '.tmp',
                                    'dist')]
                                for name in files:
                                    p = Path(base) / name
                                    try:
                                        current.append((str(p), p.stat().st_mtime_ns, p.stat().st_size))
                                    except FileNotFoundError:
                                        pass
                                if len(current) > 4096:
                                    break
                            current = str(current)
                            if current != last:
                                last = current
                                self.wfile.write(('data: ' + json.dumps(dict(id=int(time.time() * 1000000),
                                    kind='commit')) + '\n\n').encode())
                                self.wfile.flush()
                            time.sleep(1)
                    if op == 'agents':
                        return (self.respond([name for name in ('codex', 'claude', 'opencode') if __import__(
                            'shutil').which(name)]))
                    if op == 'sessions':
                        return self.respond(session('list'))
                    if op == 'run' and body.get('actor') == 'terminal-connections':
                        return self.respond(dict(exit=0, stdout_tail=json.dumps(dict(local=True, rows=session('list')))))
                    if op == 'run' and body.get('actor') == 'terminal-prompt':
                        if not session('active', id=body['session']): raise ValueError('No active session in terminal')
                        return self.respond(session('prompt', id=body['session'], text=body['text']))
                    if op in ('run', 'proc') and peers:
                        return (self.respond(dict(exit=0, stdout_tail='true' if body.get(
                            'actor') == 'terminal-session' else 'codex\n', stderr_tail='')))
                    if op == 'run' and body.get('actor') == 'terminal-session':
                        return self.respond(dict(exit=0, stdout_tail=json.dumps(session('active')), stderr_tail=''))
                    if op in ('run', 'proc'):
                        result = subprocess.run(body['argv'], cwd=root, capture_output=True, timeout=min(body.get(
                            'timeout_s', 10), 60))
                        return (self.respond(dict(exit=result.returncode, stdout_tail=result.stdout[-131072:].decode(
                            errors='replace'), stderr_tail=result.stderr[-131072:].decode(errors='replace'))))
                    if op == 'shell-client':
                        return self.respond(dict(executable='/bin/sh'))
                    if (op in ('call', 'launch', 'shell/ticket') or (op.startswith('sessions/') and op.endswith(
                        '/attach'))):
                        suppress = os.environ.get('AL_SUPPRESS_EMBEDDED', '1') != '0'
                        if op == 'shell/ticket':
                            id = session('default', suppress=suppress)
                        elif op.startswith('sessions/'):
                            id = session('focus', id=op.split('/')[1])
                        else:
                            id = session('create', suppress=suppress, argv=body['argv'] if op == 'call' else [body['agent'], *body.get('args',
                                [])])
                        ticket = secrets.token_urlsafe(24)
                        expires = time.time() + 30
                        tickets[ticket] = (id, expires)
                        return self.respond(dict(ticket=ticket, call=id, id=id, attachable=True, expires=expires))
                return self.respond(dict(error='Unsupported route'), 501)
            except PermissionError as error:
                self.respond(dict(error=str(error)), 403)
            except FileNotFoundError:
                self.respond(dict(error='Not found'), 404)
            except (BrokenPipeError, ConnectionResetError, EOFError):
                pass
            except Exception as error:
                self.respond(dict(error=str(error)), 502 if upstream else 400)

        do_DELETE = do_HEAD = do_POST = do_PUT = do_GET

        def state(self, body, renderer=False):
            nonlocal mock
            if self_app:
                from urllib.error import HTTPError
                try:
                    data = request(dict(base=mock_info['base'], token='mock'), '/al/state',
                        body if self.command != 'GET' else None, timeout=5)
                    return self.respond(data)
                except HTTPError as error:
                    return self.respond(error.read(), error.code)
            if self.command == 'GET':
                return self.respond(mock)
            name = body['state']
            if not __import__('re').fullmatch('[\\w-]+', name):
                raise ValueError('Invalid state name')
            peers.load(REPO / 'tests/states' / (name + '.json'))
            mock = peers.state
            if renderer:
                journal(root, 'renderer', body)
            return self.respond(dict(name=mock['name'], **meta()))

        def terminal(self, id):
            upgrade(self)
            wire = Wire(self)
            try:
                cursor = 0
                while True:
                    reply = session('read', id=id, cursor=cursor)
                    cursor = reply['cursor']
                    data = base64.b64decode(reply['data'])
                    if data:
                        wire.send(data)
                    if reply['exited']:
                        return
                    if select.select([self.connection], [], [], 0.025)[0]:
                        data = wire.read()
                        if data.startswith(b'\x00'):
                            cols, rows = json.loads(data[1:])['resize']
                            session('resize', id=id, cols=cols, rows=rows)
                        elif data:
                            if data.startswith(b'export ALEMBIC_TERMINAL_ID=') and session('active', id=id):
                                continue
                            if data.startswith(b'# ') and data.endswith(b'\r') and session('active', id=id):
                                session('prompt', id=id, text=data[:-1].decode())
                                continue
                            session('input', id=id, data=base64.b64encode(data).decode())
            except (EOFError, OSError):
                pass
            except Exception:
                wire.send(b'\x03\xefInvalid terminal message or session unavailable', 8)

        def proxy(self, upstream):
            self.path = vite_modules.get(self.path,self.path)
            route = unquote(urlsplit(self.path).path)
            if (any((part in ('.', '..') for part in route.split('/'))) or any((c in route for c in ('\\', '%',
                '\x00')))):
                raise PermissionError('Invalid app path')
            trusted_env=route=='/@fs'+str(vite_env)
            if route.startswith('/@fs') and not trusted_env or route.startswith('//'):
                raise PermissionError('Filesystem proxy is unavailable')
            if not trusted_env and route not in ('/', '/@vite/client', '/@vite/env'):
                if not confined(root, route.lstrip('/')).is_file():
                    raise FileNotFoundError()
            target = urlsplit(upstream)
            if target.scheme != 'http' or target.username or target.password:
                raise ValueError('Only HTTP upstreams are supported')
            connection = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=8)
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'authorization', 'cookie',
                'origin', 'content-length', 'accept-encoding')}
            headers['Host'] = target.netloc
            connection.request(self.command, self.path, headers=headers)
            response = connection.getresponse()
            if response.status == 101:
                self.send_response(101)
                for key, value in response.getheaders():
                    self.send_header(key, value)
                self.end_headers()
                self.close_connection = True
                sock = connection.sock
                while True:
                    for source in select.select([self.connection, sock], [], [], 30)[0]:
                        data = source.recv(65536)
                        if not data:
                            connection.close()
                            return
                        (sock if source is self.connection else self.connection).sendall(data)
            data = response.read()
            kind = response.getheader('Content-Type', 'application/octet-stream')
            if 'javascript' in kind:
                for alias,source in vite_modules.items():
                    data = data.replace(('"'+source+'"').encode(),('"'+alias+'"').encode())
            connection.close()
            return self.respond(data, response.status, kind)

        def preview(self, route):
            if route == '/__al/app.js':
                return self.respond((REPO / 'render/app.js').read_bytes(), kind='text/javascript')
            if route == '/__al/state' and (mock or self_app):
                if self.headers.get('Origin') not in (None, preview_origin):
                    raise PermissionError('Wrong renderer origin')
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
                return self.state(body, renderer=True)
            if route == '/__al/message':
                raise PermissionError('Renderer journal is unavailable')
            if route.startswith('/project/'):
                if (self.headers.get('Origin') not in (None, preview_origin) or
                    self.headers.get('Sec-Fetch-Site') == 'cross-site'):
                    raise PermissionError('Wrong renderer origin')
                return (self.respond(file(unquote(route[9:])), kind=mimetypes.guess_type(route)[0] or
                    'application/octet-stream'))
            asset = confined(assets, route.lstrip('/'))
            if asset.is_file():
                data = asset.read_bytes()
                return self.respond(data, kind=mimetypes.guess_type(route)[0] or 'application/octet-stream')
            if upstream:
                return self.proxy(upstream)
            raise FileNotFoundError()

    def revision(value):
        if not __import__('re').fullmatch('[a-fA-F0-9]{4,40}', value):
            raise ValueError('Expected git revision hash')
        return value

    def history(op, q, b):
        if op == 'restore':
            git(root, 'restore', '--source=' + revision(b['at']), '--worktree', '--', '.')
            return dict(at=b['at'])
        if op == 'diff':
            return ([dict(path=p, change='modified') for p in git(root, 'diff', '--name-only', revision(q['a']), *([
                revision(q['b'])] if q.get('b', 'live') != 'live' else [])).splitlines()])
        rows = [dict(commit=parts[0], at=parts[1], actor=parts[2], message=parts[3], outputs=[]) for line in git(root,
            'log', '--format=%H\t%aI\t%an\t%s', '-' + str(min(int(q.get('limit', 20)), 500)), '--', q.get('path') or
            '.').splitlines() if len((parts := line.split('\t', 3))) == 4]
        if op == 'trace':
            return (dict(path=q.get('path'), hash=hashlib.sha256(path(q['path']).read_bytes()).hexdigest(), steps=[dict(
                run=r['commit'], argv=['git', 'show', r['commit']], actor=r['actor'], commit=r[
                'commit']) for r in rows], scripts=[]))
        return (dict(nodes=[dict(id=r['commit'], kind='edit', cmd=r['message'], exit=0, **r) for r in rows], artifacts=[
            ], edges=[dict(**{'from': b['commit'], 'to': a['commit'], 'kind': 'parent'}) for a, b in zip(rows, rows[
            1:])]) if op == 'graph' else rows)

    class Server(ThreadingHTTPServer):
        request_queue_size = 128

        def handle_error(self, request, address):
            journal(root, 'transport.error', {'error': str(sys.exception())[:200]})
    controller = Server(('127.0.0.1', port), Handler)
    renderer = Server(('127.0.0.1', urlsplit(previous['preview']).port if previous else 0), Handler)
    controller.daemon_threads = renderer.daemon_threads = True
    controller_origin = 'http://127.0.0.1:' + str(controller.server_port)
    preview_origin = 'http://localhost:' + str(renderer.server_port)
    child = None
    mock_fragment = ''
    if self_app:
        from tempfile import mkdtemp
        mock_root = Path(mkdtemp(prefix='mock-', dir=os.environ['TMPDIR']))
        child, mock_info = start(mock_root, '--node', 'mock.iframe', '--state',
            str(REPO / 'tests/states/iframe-success.json'), '--allowed', preview_origin)
        mock_fragment = '#' + urlencode(dict(node=mock_info['base'], token='mock', workspace='project', vm='local',
            preview=mock_info['preview']))
    info = dict(peer=mock_info['base'] if self_app else '', pid=os.getpid(), root=str(root), node=node,
        base=controller_origin, token=token, workspace='project', vm='local', preview=preview_origin)
    import socketserver

    class Connection(socketserver.StreamRequestHandler):

        def handle(self):
            self.wfile.write(json.dumps(info).encode() + b'\n')
    fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
    secret = folder / 'connection.sock'
    secret.unlink(missing_ok=True)
    transport = socketserver.ThreadingUnixStreamServer(f'/proc/self/fd/{fd}/connection.sock', Connection)
    os.chmod(secret, 384)
    threading.Thread(target=transport.serve_forever, daemon=True).start()
    (folder / 'url').unlink(missing_ok=True)
    (folder / 'server.json').write_text(json.dumps({k: v for k, v in info.items() if k != 'token'}))
    threading.Thread(target=renderer.serve_forever, daemon=True).start()
    print('Alembic relay ready; credentials available through the owner-only socket',flush=True)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(SystemExit(0)))
    try:
        controller.serve_forever()
    finally:
        if child:
            child.terminate()
            child.wait(timeout=5)
        transport.shutdown()
        transport.server_close()
        secret.unlink(missing_ok=True)
        os.close(fd)
        renderer.shutdown()
        controller.server_close()
        renderer.server_close()
if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('root')
    args.add_argument('--port', type=int, default=0)
    for name in ('node', 'upstream', 'state', 'allowed', 'source'):
        args.add_argument('--' + name, default='')
    args.add_argument('--entry', default='index.html')
    args.add_argument('--self-app', action='store_true')
    args.add_argument('--replace', action='store_true', help='Restart this relay with the same URLs and credentials; PTY sessions survive')
    serve(**vars(args.parse_args()))
