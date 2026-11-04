"""Small shared transport, project boundary and bounded append-only journal."""
import io, threading, subprocess
import base64, fcntl, hashlib, json, os, socket, struct, time
from pathlib import Path
import urllib.request
from urllib.parse import unquote
HOME = Path(os.environ.get('AL_HOME', Path.home() / '.alembic'))
REPO = Path(__file__).resolve().parents[1]

def private(path):
    path.mkdir(parents=True, exist_ok=True, mode=448)
    return path

def identity(root):
    return hashlib.sha256(str(Path(root).resolve()).encode()).hexdigest()[:16]

def location(root):
    return private(HOME / 'relay' / identity(root))

def project_dir(root, name=''):
    path = Path(root).resolve() / '.alembic' / name
    try:
        if path.resolve() != path:
            raise OSError('Project storage must not use symlinks')
        private(path)
        with __import__('tempfile').TemporaryFile(dir=path): pass
    except OSError as error:
        raise RuntimeError(f'Cannot write project storage {path}: {error}') from error
    return path

def exclude_private(root):
    result = subprocess.run(['git', '-C', str(root), 'rev-parse', '--git-path', 'info/exclude'],
        capture_output=True, text=True)
    if result.returncode: return
    target = str(Path(root) / '.alembic') + '/'
    if subprocess.run(['git', '-C', str(root), 'check-ignore', '-q', '--no-index', target]).returncode == 0: return
    top = subprocess.check_output(['git', '-C', str(root), 'rev-parse', '--show-toplevel'], text=True).strip()
    path = Path(root) / result.stdout.strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    pattern = '/' + (Path(root) / '.alembic').relative_to(top).as_posix() + '/'
    with path.open('a') as out: out.write('\n' + pattern + '\n')

def sensitive(path):
    parts = Path(path).parts
    return any(a.casefold() == '.alembic' and b.casefold() in ('agent-home', 'logs', '.cache')
        for a, b in zip(parts, parts[1:]))

def confined(root, name):
    if not isinstance(name, str): raise PermissionError('Path outside project')
    decoded = name
    while unquote(decoded) != decoded: decoded = unquote(decoded)
    for candidate in (name, decoded):
        if ('\\' in candidate or '\x00' in candidate or candidate.startswith('/') or
            any(part.casefold() in ('..', '.git') for part in candidate.split('/'))):
            raise PermissionError('Path outside project')
        path = (root / candidate).resolve()
        if sensitive(candidate) or sensitive(path) or not path.is_relative_to(root):
            raise PermissionError('Path outside project')
    return (root / name).resolve()

def journal(root, kind, body):
    path = project_dir(root, 'logs') / 'journal.jsonl'
    record = (json.dumps(dict(at=time.time(), kind=kind, body=body), ensure_ascii=True) + '\n').encode()
    if len(record) > 65536:
        record = (json.dumps(dict(at=time.time(), kind=kind, body=str(body)[:12000], truncated=True)) + '\n').encode()
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if path.exists() and path.stat().st_size + len(record) > 524288:
            path.replace(path.with_suffix('.jsonl.1'))
        with path.open('ab') as out:
            out.write(record)

def socket_request(root, name, body=None):
    with socket.socket(socket.AF_UNIX) as sock:
        folder = os.open(location(root), os.O_RDONLY | os.O_DIRECTORY)
        try:
            sock.connect(f'/proc/self/fd/{folder}/{name}.sock')
        finally:
            os.close(folder)
        if body is not None:
            sock.sendall((json.dumps(body) + '\n').encode())
        return json.loads(sock.makefile('rb').readline())

def connection(root):
    return socket_request(root, 'connection')

def rpc(root, op, **body):
    result = socket_request(root, 'pty', dict(op=op, **body))
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result['result']

def upgrade(handler):
    key = handler.headers.get('Sec-WebSocket-Key', '')
    if handler.headers.get('Sec-WebSocket-Version') != '13' or len(base64.b64decode(key, validate=True)) != 16:
        raise ValueError('Invalid WebSocket')
    handler.send_response(101)
    handler.send_header('Upgrade', 'websocket')
    handler.send_header('Connection', 'Upgrade')
    handler.send_header('Sec-WebSocket-Accept', base64.b64encode(hashlib.sha1((key +
        '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode())
    handler.end_headers()
    handler.close_connection = True

class Wire:

    def __init__(self, handler):
        self.socket = handler.connection
        self.file = handler.rfile
        self.fragment = bytearray()

    def send(self, data, opcode=2):
        size = len(data)
        self.socket.sendall(bytes([128 | opcode]) + (bytes([size]) if size < 126 else b'~' + struct.pack('!H', size) if
            size < 65536 else b'\x7f' + struct.pack('!Q', size)) + data)

    def take(self, size):
        data = b''
        while len(data) < size:
            part = self.file.read(size - len(data))
            if not part:
                raise EOFError()
            data += part
        return data

    def read(self):
        head = self.take(2)
        if not head[1] & 128:
            raise EOFError()
        size = head[1] & 127
        if size >= 126:
            size = struct.unpack('!H' if size == 126 else '!Q', self.take(2 if size == 126 else 8))[0]
        if size > 1048576:
            raise ValueError('WebSocket message too large')
        mask = self.take(4)
        data = self.take(size)
        data = bytes((byte ^ mask[i % 4] for i, byte in enumerate(data)))
        op = head[0] & 15
        if op == 8:
            raise EOFError()
        if op == 9:
            self.send(data, 10)
            return b''
        if op == 10:
            return b''
        self.fragment.extend(data)
        if len(self.fragment) > 1048576:
            raise ValueError('WebSocket message too large')
        if not head[0] & 128:
            return b''
        data = bytes(self.fragment)
        self.fragment.clear()
        return data

def request(info, route, body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(urllib.request.Request(info['base'] + route, data, {'Authorization': 'Bearer ' + info[
        'token'], 'Content-Type': 'application/json'}), timeout=timeout) as response:
        return response.read()

def app_rows(root):
    path = root / 'exports.txt'
    rows = [line.split('\t') for line in path.read_text().splitlines()] if path.is_file() else []
    return rows if any((len(row) == 4 and row[0] == 'render' and (row[2] == 'app') for row in rows)) else []

def stop(pid, marker):
    if marker.encode() not in Path('/proc', str(pid), 'cmdline').read_bytes():
        raise ValueError('Stale process PID')
    os.kill(pid, __import__('signal').SIGTERM)
    for _ in range(100):
        status=Path('/proc',str(pid),'stat')
        if not status.exists() or status.read_text().split(') ',1)[1].startswith('Z'):return
        time.sleep(.05)
    raise RuntimeError('Process did not stop')

class BoundedLog(io.TextIOBase):

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()

    def write(self, text):
        data = text.encode(errors='replace')[-524288:]
        with self.lock:
            if self.path.exists() and self.path.stat().st_size + len(data) > 524288:
                self.path.write_bytes(b'')
            with self.path.open('ab') as out:
                out.write(data)
        return len(text)

def launch_url(info):
    from urllib.parse import urlencode
    return (info['base'] + '/?' + urlencode(dict(file=info['node'])) + '#' + urlencode({k: info[k] for k in ('token',
        'workspace', 'vm', 'preview')} | dict(node=info['base'])))

def html_prefix(data, tag):
    import re
    pattern=rb'(?i)(<head(?:\s[^>]*)?>|<!doctype[^>]*>)'
    return re.sub(pattern,lambda match:match[0]+tag,data,count=1) if re.search(pattern,data) else tag+data

def start(root, *args):
    import subprocess, sys
    folder = location(root)
    log_path = project_dir(root, 'logs') / 'server.log'
    exclude_private(root)
    with log_path.open('wb') as log:
        process = subprocess.Popen([sys.executable, '-B', str(REPO / 'backend/server.py'), str(root), *args],
            stdout=log, stderr=log, start_new_session=True)
    for _ in range(100):
        path = folder / 'server.json'
        if path.exists() and json.loads(path.read_text())['pid'] == process.pid:
            return process, connection(root)
        if process.poll() is not None:
            raise RuntimeError(log_path.read_text())
        time.sleep(0.03)
    process.terminate()
    process.wait(timeout=5)
    raise RuntimeError('Relay startup timed out; inspect ' + str(log_path))
