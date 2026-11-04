"""WSL execution, native Windows window. Never launch a Linux GUI or create a VM."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
def windows(path):
    return subprocess.check_output(['wslpath', '-w', str(path)], text=True).strip()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, help='Explicitly attach to this project; omit to discover projects first')
    parser.add_argument('--minimal', action='store_true')
    parser.add_argument('--debug-port', type=int, default=0, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not os.environ.get('WSL_DISTRO_NAME'):
        parser.error('This launcher is for WSL → native Windows. On other platforms run the packaged app directly.')
    if not 0 <= args.debug_port <= 65535:
        parser.error('Invalid debug port')
    if args.project is None:
        subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                        "Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'al_linux.lnk')"], check=True)
        return
    sys.path.insert(0, str(ROOT))
    from launcher import existing_vault, controller_port, project_preview, vc, sandbox
    from linux_backend import available_agents
    identity = json.loads((args.project.resolve()/'.alembic/project.json').read_text())['id']
    running = existing_vault()
    rows = [row for row in running[1] if row['workspace'] == identity] if running else []
    if len(rows) != 1:
        parser.error('Launch this project with launcher.py first; this command never creates or replaces a VM.')
    port = controller_port(running[0])
    if not port:
        parser.error('Unable to identify the existing controller port')
    origin = f'http://127.0.0.1:{port}'
    vm = vc.VM.from_id(rows[0]['id'])
    entry = ''
    try:
        record = next(row for row in sandbox._request('GET', '/workspaces') if row['id'] == identity)
        notice = json.loads(vc.Workspace(record).file('.alembic/preview.json'))
        candidate = notice.get('path', '')
        if notice.get('version') == 1 and isinstance(candidate, str) and candidate and len(candidate) < 500 and '\\' not in candidate and all(part and not part.startswith('.') for part in candidate.split('/')):
            entry = '?' + urlencode({'file': candidate})
    except (vc.NodeError, ValueError, TypeError):
        pass
    url = origin + '/' + entry + '#' + urlencode(dict(node=origin, token=(sandbox._store()/'token').read_text().strip(),
        workspace=identity, vm=vm.id, agents=','.join(available_agents(vm)), preview=project_preview(origin,identity)))
    package = ROOT/'desktop'
    version = json.loads((package/'package.json').read_text())['devDependencies']['electron']
    checksums = json.loads((package/'node_modules/electron/checksums.json').read_text())
    checksum = checksums[f'electron-v{version}-win32-x64.zip']
    fd, name = tempfile.mkstemp(prefix='alembic-windows-', suffix='.json')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(dict(package=windows(package),version=version,checksum=checksum,url=url,minimal=args.minimal,debugPort=args.debug_port,backend='linux',session=hashlib.sha256((identity + '\0' + str(args.project.resolve())).encode()).hexdigest()),stream)
        subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',windows(ROOT/'desktop/open-windows.ps1'),'-LaunchConfig',windows(name)],check=True)
    finally:
        Path(name).unlink(missing_ok=True)
if __name__ == '__main__':
    main()
