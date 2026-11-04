"""Deploy shared desktop and built frontend files to the Windows installation from WSL."""
import argparse
import hashlib
import os
import tempfile
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--install', type=Path, default=Path('/mnt/c/playground/alembic'))
a = p.parse_args()
if not (a.install/'consumer/windows_controller.py').is_file():
    p.error('Target is not an existing native Alembic installation')
if not (root/'frontend/dist/index.html').is_file():
    p.error('Build the shared frontend before syncing')
def put(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix='.' + target.name + '.', suffix='.tmp', dir=target.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, 'wb') as output, source.open('rb') as input_file:
            shutil.copyfileobj(input_file, output)
            output.flush()
            os.fsync(output.fileno())
        if hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(temp.read_bytes()).digest():
            raise RuntimeError('Copy verification failed: ' + str(target))
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)
for name in ('bootstrap.py','main.cjs','connection.cjs','preload.cjs','package.json','open-windows.ps1','install-shortcuts.ps1'):
    put(root/'desktop'/name, a.install/'desktop'/name)
put(root/'desktop/node_modules/electron/checksums.json', a.install/'desktop/checksums.json')
put(root/'project_discovery.py', a.install/'consumer/project_discovery.py')
put(root/'desktop/native_adapter/windows_controller.py', a.install/'consumer/windows_controller.py')
for source in sorted((root/'frontend/dist').rglob('*'), key=lambda path: path.name == 'index.html'):
    if source.is_file():
        relative = source.relative_to(root/'frontend/dist')
        if relative.as_posix() in ('assets/agent-queue.json','assets/native-view.json','assets/preview-origin.json'):
            continue
        put(source, a.install/'consumer/frontend/dist'/relative)
print('Windows shared files synced and SHA-256 verified:', a.install)
