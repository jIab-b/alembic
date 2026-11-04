"""Detached PTY holder. Unix socket access is restricted to its owner."""
import shutil
import base64, fcntl, json, os, pty, signal, socket, socketserver, struct, subprocess, sys, termios, threading, time, uuid
from common import HOME, REPO, location, private, journal, rpc, project_dir, exclude_private
from pathlib import Path
from completion import RULE

def ensure(root):
    folder = location(root)
    with (folder / 'start.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            rpc(root, 'list')
            if (HOME / 'agent-home' / folder.name).exists():
                raise ValueError('Legacy agent home is in use by the holder; close its sessions and restart the holder')
        except (OSError, RuntimeError):
            project_dir(root)
            exclude_private(root)
            with (folder / 'holder.lock').open('a') as held:
                try: fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise RuntimeError('Session holder is still running; cannot migrate agent history')
                home = project_dir(root) / 'agent-home'
                old = HOME / 'agent-home' / folder.name
                if old.exists():
                    if home.exists(): raise RuntimeError('Both agent homes exist; preserve and reconcile history first')
                    shutil.move(str(old), str(home))
            project_dir(root, '.cache')
            child = subprocess.Popen([sys.executable, '-B', str(REPO / 'backend/sessions.py'), str(root)],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            threading.Thread(target=child.wait, daemon=True).start()
            for _ in range(100):
                try:
                    rpc(root, 'list')
                    break
                except OSError:
                    time.sleep(0.03)
            else:
                raise RuntimeError('PTY holder did not start')
    return folder

class Holder:

    def __init__(self, root):
        self.root = root
        temp = project_dir(root, '.cache') / 'tmp'
        if temp.exists(): shutil.rmtree(temp)
        private(temp)
        self.sessions = {}
        self.focus = None
        self.lock = threading.RLock()

    def create(self, suppress=True, argv=None, external=False):
        self.sessions = {id: row for id, row in self.sessions.items() if not row['exited']}
        if len(self.sessions) >= 32:
            raise ValueError('At most 32 live sessions per project')
        id = uuid.uuid4().hex
        env = dict(os.environ, TERM='xterm-256color', ALEMBIC_SESSION=id, ALEMBIC_ROOT=str(REPO))
        cache = project_dir(self.root, '.cache')
        env.update({key: str(cache / name) for key, name in dict(TMPDIR='tmp', TMP='tmp', TEMP='tmp',
            XDG_CACHE_HOME='cache', XDG_CONFIG_HOME='config', PYTHONUSERBASE='python', PIP_CACHE_DIR='pip',
            npm_config_cache='npm', npm_config_prefix='npm-prefix', HISTFILE='history',
            CARGO_HOME='cargo', RUSTUP_HOME='rustup', CUDA_CACHE_PATH='cuda', LESSHISTFILE='less-history',
            NODE_REPL_HISTORY='node-history', SQLITE_HISTORY='sqlite-history', PYTHON_HISTORY='python-history',
            PYTHONPYCACHEPREFIX='pycache', npm_config_userconfig='npmrc').items()})
        home = project_dir(self.root, 'agent-home')
        for name, source in [('auth.json', Path.home() / '.codex/auth.json'), ('.credentials.json', Path.home(
            ) / '.claude/.credentials.json')]:
            target = home / name
            if not target.exists() and (not target.is_symlink()):
                target.symlink_to(source)
        config, source = home / 'config.toml', Path.home() / '.codex/config.toml'
        if not config.exists() and source.is_file():  # A copy: Codex writes to this file.
            config.write_bytes(source.read_bytes())
        env.update(CODEX_HOME=str(home), CLAUDE_CONFIG_DIR=str(home), XDG_DATA_HOME=str(home))
        for name in ('AGENTS.md', 'CLAUDE.md'): (home / name).write_text(RULE + '\n')
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(self.root)
            os.execvpe((argv or ['/bin/bash'])[0], argv or ['/bin/bash', '-i'], env)
        row = dict(id=id, pid=pid, fd=fd, suppress=suppress, agent=Path((argv or ['shell'])[0]).name, external=external,
            attachable=True, last_command=time.time() * 1000, output=b'', offset=0, exited=False)
        self.sessions[id] = row
        self.focus = id

        def reader():
            try:
                while True:
                    data = os.read(fd, 32768)
                    if not data:
                        break
                    with self.lock:
                        row['output'] = (row['output'] + data)[-131072:]
                        row['offset'] += len(data)
                        modes = row['output']; on, off = modes.rfind(b'\x1b[?2004h'), modes.rfind(b'\x1b[?2004l')
                        if max(on, off) >= 0: row['bracketed'] = on > off
                    journal(self.root, 'session.output', dict(session=id, bytes=base64.b64encode(data).decode()))
            except OSError:
                pass
            finally:
                row['exited'] = True
                os.waitpid(pid, 0)
                os.close(fd)
        threading.Thread(target=reader, daemon=True).start()
        journal(self.root, 'session.created', dict(session=id, suppress=suppress))
        return id

    def program(self, row):
        if row['exited']: return None
        if 'waiter' in row: return dict(pid=row['pid'], name=row['agent'])
        try:
            group = os.tcgetpgrp(row['fd'])
            if row['agent'] == 'shell' and group == row['pid']: return None
            args = Path(f'/proc/{group}/cmdline').read_bytes().decode(errors='replace').split('\0')
            name = Path(args[0]).name
            if name in ('node', 'nodejs', 'python', 'python3', 'bash', 'sh'):
                name = next((Path(arg).stem for arg in args[1:] if arg and not arg.startswith('-')), name)
                if name == 'cli': name = 'claude' if any('claude' in a for a in args) else next((a for a in ('codex', 'opencode') if any(a in v for v in args)), name)
            return dict(pid=group, name=name)
        except (OSError, IndexError): return None

    def dispatch(self, op, **body):
        with self.lock:
            if op == 'list':
                return [dict({k: v for k, v in row.items() if k not in ('fd', 'output', 'waiter')}, active=self.dispatch('active', id=row['id']), program=self.program(row)) for row in self.sessions.values()]
            if op == 'create':
                return self.create(**body)
            if op == 'default':
                return (self.focus if self.focus and (not self.sessions[self.focus]['exited']) else self.create(
                    suppress=body.get('suppress', True)))
            row = self.sessions[body.get('id') or self.focus]
            id = row['id']
            if op == 'active':
                return self.program(row) is not None
            if op == 'focus':
                self.focus = id
                return id
            if op == 'read':
                start = max(body.get('cursor', 0), row['offset'] - len(row['output']))
                return (dict(cursor=row['offset'], data=base64.b64encode(row['output'][start - row['offset']:] if
                    start < row['offset'] else b'').decode(), exited=row['exited']))
            if op == 'resize':
                fcntl.ioctl(row['fd'], termios.TIOCSWINSZ, struct.pack('HHHH', body['rows'], body['cols'], 0, 0))
                return True
            if op in ('input', 'prompt'):
                if 'waiter' in row:
                    if op != 'prompt' or row['exited']: raise ValueError('Waiter accepts prompts only')
                    row['waiter'].sendall((body['text'] + '\n').encode())
                    row['exited'] = row.get('once', False)
                    return True
                data = base64.b64decode(body['data']) if op == 'input' else ((('\x1b[200~' + body['text'] + '\x1b[201~') if row.get('bracketed') else body['text']) + '\r').encode()
                self.focus = id
                os.write(row['fd'], data)
                row['last_command'] = time.time() * 1000
                journal(self.root, 'session.' + op, dict(session=id, bytes=base64.b64encode(data).decode()))
                return True
            if op == 'kill':
                if 'waiter' in row:
                    row['waiter'].shutdown(socket.SHUT_RDWR)
                    return True
                group = os.tcgetpgrp(row['fd'])
                if group != row['pid']:
                    os.killpg(group, signal.SIGKILL)
                os.killpg(row['pid'], signal.SIGKILL)
                return True
            raise ValueError('Unknown session operation')

def serve(root):
    folder = location(root)
    with (folder / 'holder.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = folder / 'pty.sock'
        path.unlink(missing_ok=True)
        holder = Holder(root)

        class Handler(socketserver.StreamRequestHandler):

            def handle(self):
                id = None
                try:
                    body = json.loads(self.rfile.readline(1500000))
                    if body.get('op') == 'wait':
                        name = body['name']
                        if not isinstance(name, str) or not name.strip() or len(name)>80 or any(ord(c)<32 for c in name): raise ValueError('Invalid waiter name')
                        pid, _, _ = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                        id = uuid.uuid4().hex
                        with holder.lock:
                            holder.sessions[id] = dict(id=id, pid=pid, agent=name, external=True, attachable=False,
                                exited=False, waiter=self.request, once=body.get('once', False))
                            self.wfile.write((json.dumps(dict(result=id))+'\n').encode()); self.wfile.flush()
                        self.rfile.read(1)  # EOF wakes us immediately when the waiter exits.
                        return
                    result = dict(result=holder.dispatch(**body))
                except Exception as error:
                    result = dict(error=str(error))
                finally:
                    if id:
                        with holder.lock: holder.sessions.pop(id, None)
                self.wfile.write((json.dumps(result) + '\n').encode())

        class Server(socketserver.ThreadingUnixStreamServer):
            daemon_threads = True
        fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
        (folder / 'holder.pid').write_text(str(os.getpid()))
        with Server('/proc/self/fd/' + str(fd) + '/pty.sock', Handler) as server:
            os.chmod(path, 384)
            server.serve_forever()
if __name__ == '__main__':
    serve(Path(sys.argv[1]).resolve())
