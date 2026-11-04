"""Verify public-clone installation and foreground startup. Run under the heavy-work lock."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

repo = Path(__file__).resolve().parents[1]
work = Path(os.environ['TMPDIR'])
copy = work / 'clean'
copy.mkdir()
names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=repo)
for name in set(names.decode().split('\0')):
    source = repo / name
    if not source.is_file(): continue
    target = copy / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
env = {**os.environ, 'AL_HOME': str(work / 'clean-home'), 'npm_config_cache': str(work / 'npm-cache')}
env.pop('AL_ASSETS', None)
with (work / 'clean-install.log').open('w') as log:
    subprocess.run(['npm', 'install'], cwd=copy, env=env, stdout=log, stderr=log, check=True)
assert not (copy / 'node_modules/electron').exists()
os.environ['AL_HOME'] = env['AL_HOME']
sys.path.insert(0, str(copy / 'backend'))
from common import connection, location, rpc
empty = work / 'empty-project'
empty.mkdir(exist_ok=True)
for project in (empty, copy / 'tests/mock/demos'):
    with (work / ('start-' + project.name + '.log')).open('w') as log:
        app = subprocess.Popen(['npm', 'start', '--', '--no-open', str(project)], cwd=copy,
            env=env, stdout=log, stderr=log, start_new_session=True)
        info = None
        try:
            for _ in range(600):
                if app.poll() is not None: raise RuntimeError('npm start exited; inspect start log')
                try: info = connection(project); break
                except (OSError, ValueError): time.sleep(.1)
            assert info, 'Server did not start'
            with urllib.request.urlopen(info['base']) as response:
                assert response.status == 200
            assert (project / '.alembic').is_dir()
            assert not (copy / '.alembic').exists()
            print('PASS clean npm install/start:', 'empty' if project == empty else 'demos', flush=True)
        finally:
            if app.poll() is None: os.killpg(app.pid, signal.SIGTERM)
            app.wait(timeout=10)
            marker = location(project) / 'holder.pid'
            if marker.exists():
                for row in rpc(project, 'list'):
                    if not row['exited']: rpc(project, 'kill', id=row['id'])
                os.kill(int(marker.read_text()), signal.SIGTERM)
# Keep the clean tree for browser checks and packaging; caller owns and removes it.
