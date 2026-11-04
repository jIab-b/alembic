"""WSL execution, native Windows window. Never launch a Linux GUI or create a VM."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
def windows(path):
    return subprocess.check_output(['wslpath', '-w', str(path)], text=True).strip()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True, help='Project directory')
    parser.add_argument('--minimal', action='store_true')
    parser.add_argument('--debug-port', type=int, default=0, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not os.environ.get('WSL_DISTRO_NAME'):
        parser.error('This launcher is for WSL → native Windows. On other platforms run the packaged app directly.')
    if not 0 <= args.debug_port <= 65535:
        parser.error('Invalid debug port')
    if args.project is None:
        parser.error('--project is required')
    project = args.project.resolve()
    sys.path.insert(0, str(ROOT / 'backend'))
    from common import connection, launch_url
    try:
        info = connection(project)
    except OSError:
        subprocess.run([str(ROOT / 'backend/al'), 'embed', str(project)], check=True, capture_output=True)
        info = connection(project)
    url = launch_url(info)
    identity = str(project)
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
