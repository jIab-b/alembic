"""Windows desktop bootstrap. Backend selection is fixed by the shortcut."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlencode

BASE = Path(__file__).resolve().parent
CONFIG = Path.home() / '.alembic' / 'desktop.txt'
CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

def command(args, **kwargs):
    kwargs.setdefault('creationflags', CREATE_NO_WINDOW)
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout

def process_identity(pid):
    import ctypes
    from ctypes import wintypes
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    api.OpenProcess.restype = wintypes.HANDLE
    api.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = api.OpenProcess(0x1000, False, int(pid))
    if not handle:
        if ctypes.get_last_error() == 87: return None
        raise RuntimeError('Cannot verify controller process identity')
    try:
        created, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
        if not api.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)):
            raise RuntimeError('Cannot read controller process identity')
        return (created.dwHighDateTime << 32) | created.dwLowDateTime
    finally: api.CloseHandle(handle)

def stale_owner(record, identity=process_identity):
    return identity(record['pid']) != record['process_created']

def main():
    if '--supervise' in sys.argv:
        import shutil
        state = Path(sys.argv[-1])
        try:
            env = os.environ.copy()
            extensions = sorted((Path.home()/'.vscode/extensions').glob('openai.chatgpt-*/bin/windows-x86_64/codex.exe'), key=lambda x: x.stat().st_mtime, reverse=True)
            if extensions:
                env['ALEMBIC_CODEX_BIN'] = str(extensions[0].parent)
                env['ALEMBIC_CODEX_HOME'] = str(BASE.parent/'state/agent-home')
            subprocess.run([sys.executable, '-B', '-X', 'utf8', str(BASE.parent/'consumer/windows_controller.py'), '--project', sys.argv[-2], '--state', str(state)], env=env, creationflags=CREATE_NO_WINDOW, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        finally:
            for name in ('stop', 'connection.private.json', 'launch.private.json'):
                (state/name).unlink(missing_ok=True)
        return
    p = argparse.ArgumentParser()
    p.add_argument('--backend', required=True, choices=('windows', 'linux'))
    p.add_argument('--project')
    p.add_argument('--headless-session', action='store_true', help='Start and verify a native session, then stop it')
    p.add_argument('--headless', action='store_true', help='Discover and report mapping without opening a window')
    a = p.parse_args()
    if a.headless_session and not a.project:
        raise RuntimeError('--headless-session requires --project')
    cfg = json.loads(CONFIG.read_text(encoding='utf-8'))
    if cfg.get('schema_version') != 1:
        raise RuntimeError('Unsupported desktop configuration version')
    if cfg.get('backend_engine', 'legacy') != 'legacy':
        raise RuntimeError('This launcher supports the pinned Elixir Vault; obsolete backend configuration must be updated.')
    if a.backend == 'windows':
        prefix = [sys.executable, str(BASE.parent / 'consumer' / 'project_discovery.py')]
    else:
        discovery_root = cfg.get('legacy_linux_install', cfg['linux_install'])
        prefix = ['wsl.exe', '-d', cfg['wsl_distro'], '--', 'python3', discovery_root + '/project_discovery.py']
    version = json.loads(command(prefix + ['version']))
    if version.get('protocol_version') != 1 or 'discover_projects' not in version.get('capabilities', []):
        raise RuntimeError('Backend does not support the required discovery protocol')
    projects = json.loads(command(prefix + ['discover']))
    if isinstance(projects, dict):
        projects = projects['projects']
    if a.headless:
        print(json.dumps({'backend': a.backend, 'projects': projects, 'protocol': version}))
        return
    if not projects:
        raise RuntimeError('No Alembic projects found. Configure search_roots in ~/.alembic/settings.txt for this backend.')
    if a.project:
        selected = next((x for x in projects if x['path'] == a.project or x['id'] == a.project), None)
        if not selected: raise RuntimeError('Selected project was not discovered')
    else:
        import tkinter as tk
        from tkinter import ttk
        root = tk.Tk(); root.title('Alembic — ' + a.backend); root.geometry('650x340')
        ttk.Label(root, text='Choose a project').pack(anchor='w', padx=12, pady=8)
        box = tk.Listbox(root); box.pack(fill='both', expand=True, padx=12)
        for item in projects: box.insert('end', item.get('name', item['id']) + '  —  ' + item['path'])
        result = []
        def choose():
            if box.curselection(): result.append(projects[box.curselection()[0]]); root.destroy()
        ttk.Button(root, text='Open', command=choose).pack(pady=10)
        box.bind('<Double-Button-1>', lambda e: choose()); root.mainloop()
        if not result: return
        selected = result[0]
    if selected.get('ambiguous'):
        raise RuntimeError('This project ID is duplicated in the configured search roots; resolve the duplicate before opening.')
    if a.backend == 'linux':
        backend = ['wsl.exe', '-d', cfg['wsl_distro'], '--', 'python3', cfg.get('legacy_linux_install', cfg['linux_install']) + '/linux_backend.py']
        info = json.loads(command(backend + ['inspect', selected['path']]))
        if info.get('protocol_version') != 1 or 'open_project' not in info.get('capabilities', []):
            raise RuntimeError('Linux backend does not support the required open protocol')
        subprocess.run(backend + ['open', selected['path']] + (['--headless'] if a.headless_session else []), check=True)
        return
    session_key = hashlib.sha256((selected['id'] + '\0' + selected['path']).encode('utf-8')).hexdigest()
    state = BASE.parent / 'state' / ('desktop-' + session_key)
    state.mkdir(parents=True, exist_ok=True)
    connection = state/'connection.private.json'
    # Serialize concurrent shortcut clicks until the controller is ready.
    import msvcrt
    lock = (BASE.parent/'state'/('desktop-' + session_key + '.lock')).open('a+b')
    lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
    msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
    proc = None
    if connection.exists():
        try:
            from urllib.request import urlopen
            prior = json.loads(connection.read_text())
            from urllib.request import Request
            request = Request(prior['base'] + '/vms', headers={'Authorization': 'Bearer ' + prior['token']})
            with urlopen(request, timeout=2) as response:
                rows = json.load(response)
                if not any(row.get('workspace') == selected['id'] and row.get('id') == prior['vm'] for row in rows):
                    raise RuntimeError('Controller workspace mismatch')
            if prior['workspace'] != selected['id'] or os.path.normcase(prior['project']) != os.path.normcase(selected['path']):
                raise RuntimeError('Controller project mismatch')
        except Exception:
            try:
                old = json.loads(connection.read_text())
                dead = stale_owner(old)
            except Exception: dead = False
            if not dead:
                raise RuntimeError('Existing controller state is unavailable; inspect ' + str(state))
            connection.unlink()
            (state/'stop').unlink(missing_ok=True)
    if not connection.exists():
        (state/'stop').unlink(missing_ok=True)
        log = (state/'supervisor.log').open('w')
        proc = subprocess.Popen([sys.executable, str(BASE/'bootstrap.py'), '--supervise', selected['path'], str(state)], stdout=log, stderr=subprocess.STDOUT, creationflags=CREATE_NO_WINDOW)
    try:
        connection = state/'connection.private.json'
        deadline = time.monotonic() + 45
        while not connection.exists():
            if proc and proc.poll() is not None: raise RuntimeError('Native controller exited; see ' + str(state/'controller.log'))
            if time.monotonic() > deadline: raise RuntimeError('Native controller did not become ready; see ' + str(state/'controller.log'))
            time.sleep(.1)
        c = json.loads(connection.read_text())
        if c.get('protocol_version') != 1 or 'open_project' not in c.get('capabilities', []):
            raise RuntimeError('Native backend does not support the required open protocol')
        origin = c['base']
        if a.headless_session:
            from urllib.request import urlopen
            with urlopen(origin + '/', timeout=5) as response:
                if response.status != 200: raise RuntimeError('Native frontend unavailable')
            print(json.dumps({'backend': 'windows', 'project': selected['path'], 'workspace': c['workspace'], 'frontend_status': 200}))
            if proc:
                (state/'stop').touch()
                proc.wait(timeout=60)
            return
        url = origin + '/#' + urlencode(dict(node=origin, token=c['token'], workspace=c['workspace'], vm=c['vm'], agents=','.join(c.get('agents', [])), preview=c['preview']))
        package = json.loads((BASE/'package.json').read_text())
        checksums = json.loads((BASE/'checksums.json').read_text())
        version = package['devDependencies']['electron']
        launch = dict(package=str(BASE), version=version, checksum=checksums[f'electron-v{version}-win32-x64.zip'], url=url, minimal=False, debugPort=0, backend='windows', session=session_key, stopFile=str(state/'stop'))
        launch_file = state/'launch.private.json'; launch_file.write_text(json.dumps(launch))
        try: subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(BASE/'open-windows.ps1'), '-LaunchConfig', str(launch_file)], check=True, creationflags=CREATE_NO_WINDOW)
        finally: launch_file.unlink(missing_ok=True)
    except BaseException:
        if proc:
            (state/'stop').touch()
            try: proc.wait(timeout=60)
            except subprocess.TimeoutExpired: proc.terminate(); proc.wait(timeout=10)
        raise

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        if '--headless' in sys.argv or '--headless-session' in sys.argv or '--supervise' in sys.argv: print(str(exc) + '\n' + str(getattr(exc, 'stdout', '') or ''), file=sys.stderr)
        else:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, str(exc), 'Alembic launch failed', 0x10)
        sys.exit(1)
