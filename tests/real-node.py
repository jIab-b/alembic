"""Disposable real stack, started by the vpsctl package; JSON-line RPC for acceptance."""
import json
import os
from pathlib import Path
import signal
import socket
import sys
from unittest.mock import patch

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path.home() / 'vspctl'))
from vpsctl import sandbox


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    root = Path(sys.argv[1]).resolve()
    # Replace the whole environment before invoking the package. Never inherit stores or credentials.
    env = {k: os.environ[k] for k in ('PATH', 'VPSCTL_NODE', 'SW_ISOLATOR', 'SW_ISOLATOR_KIND') if k in os.environ}
    env.update(HOME=str(root / 'home'), SW_STORE=str(root / 'store'), XDG_RUNTIME_DIR=str(root / 'runtime'),
               SW_ROLE='local', SW_HTTP_PORT=str(port()), SW_IDLE_EXIT='30', SW_CONSOLE_DIR=str(REPO/'frontend/dist'))
    for key in ('HOME', 'SW_STORE', 'XDG_RUNTIME_DIR'):
        Path(env[key]).mkdir(mode=0o700, parents=True)
    os.environ.clear()
    os.environ.update(env)
    assert sandbox._store() == root / 'store'
    assert sandbox._socket() == root / 'runtime/vpsctl/node.sock'
    processes, vm = [], None
    log = (root / 'node.log').open('wb')
    launch = sandbox.subprocess.Popen

    def owned_launch(*args, **kwargs):
        kwargs.update(stdout=log, stderr=log)
        kwargs['env']['ERL_FLAGS'] = '+S 4:4'
        process = launch(*args, **kwargs)
        processes.append(process)
        return process

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        # workspace() boots the node using the package's own guarded connection path.
        with patch.object(sandbox.subprocess, 'Popen', owned_launch):
            ws = sandbox.workspace(root / 'project')
        first = ws.head
        # Synthetic chat agent named like the claude variant. It runs on the host and never reads agent credentials.
        (root / 'bin').mkdir()
        fixture = root / 'bin/claude'
        fixture.write_text('#!/bin/sh\nprintf \'{"result":"fixture: %s","session_id":"fixture-1"}\\n\' "$2"\n')
        fixture.chmod(0o700)
        ws.write('.vps', 'agents = ' + json.dumps([str(fixture)]) + '\n')
        vm = sandbox.vm(wspc=ws, isolation='light', limits={'cpu':2,'memory_mb':1024,'pids':128})
        baseline = vm.run(['python3', '-c', "from pathlib import Path; p=Path('scene.svg'); p.write_text(p.read_text().replace('red','blue'))"], timeout_s=10)
        if baseline.exit != 0:
            raise RuntimeError('Baseline fixture failed: ' + baseline.stderr)
        first = ws.head
        # All four wire kinds: a turn, an edit, a command producing assets, then a consumer.
        ws.write('edit.txt', 'an outside edit')
        script = """
import http.client, socket, json, shutil
from pathlib import Path
class Control(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.connect('/run/vpsctl.sock')
def call(path, body):
    c = Control('localhost')
    c.request('POST', path, json.dumps(body), {'Content-Type': 'application/json'})
    r = c.getresponse()
    if r.status != 200: raise RuntimeError(r.read().decode())
    r.read(); c.close()
call('/turn/begin', {'session':'fixture', 'text':'Make a preview'})
call('/hook/begin', {'session':'fixture','cmd':'make preview','cwd':'','env':{}})
Path('note.txt').write_text('AFTER')
Path('scene.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="orange"/></svg>')
shutil.copyfile('preview.png', 'baked.png')
shutil.copyfile('model.glb', 'baked.glb')
call('/hook/end', {'session':'fixture','exit':0,'background':False})
call('/hook/begin', {'session':'fixture','cmd':'cat baked.png','cwd':'','env':{}})
call('/hook/end', {'session':'fixture','exit':0,'background':False})
call('/turn/end', {'session':'fixture'})
"""
        result = vm.run(['python3', '-c', script], timeout_s=20)
        if result.exit != 0:
            raise RuntimeError('Fixture command failed: ' + result.stderr)
        second = ws.head
        token = (root / 'store/token').read_text().strip()  # This fixture's fresh token only.
        origin = f"http://127.0.0.1:{env['SW_HTTP_PORT']}"
        print(json.dumps({'origin':origin,'frontend':origin,'token':token,'workspace':ws.id,
                          'vm':vm.id,'first':first,'second':second,'agents':[str(fixture)]}),flush=True)
        for line in sys.stdin:
            request = json.loads(line)
            if request['op'] == 'close':
                break
            try:
                op, args = request['op'], request.get('args', [])
                result = getattr(ws, op)(*args)
                if isinstance(result, bytes):
                    import base64
                    result = {'base64': base64.b64encode(result).decode()}
                print(json.dumps({'id': request['id'], 'result': result}), flush=True)
            except Exception as exc:
                print(json.dumps({'id': request['id'], 'error': str(exc)}), flush=True)
    finally:
        try:
            if vm:
                vm.stop()
        finally:
            for process in processes:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except sandbox.subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            log.close()


if __name__ == '__main__':
    main()
