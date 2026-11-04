"""Run the composition playground through the existing native Windows Chrome harness."""
import importlib.machinery
import os
from pathlib import Path
import shutil
import signal
import sys
import tempfile

sys.dont_write_bytecode = True
repo = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo / 'backend'))
sys.path.insert(0, str(repo / 'tests'))


def main():
    if not (repo / 'tests/mock/test_scene').is_dir():
        print('SKIP: optional test_scene is absent')
        return 0
    temporary = Path(os.environ['TMPDIR'])
    temporary.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='composition-', dir=temporary) as directory:
        work = Path(directory)
        os.environ.update(TMPDIR=str(work), AL_HOME=str(work / 'home'),
                          AL_ASSETS=str(repo / 'frontend/dist'))
        from common import start, launch_url, location, rpc
        runner = importlib.machinery.SourceFileLoader('composition_windows', str(repo / 'tests/windows-run.py')).load_module()
        project = work / 'project'
        shutil.copytree(repo / 'tests/mock/test_scene', project / 'test_scene')
        shutil.copy2(repo / 'tests/fixtures/codex', project / 'codex')
        process, info = start(project)
        url = work / 'url'
        url.write_text(launch_url(info))
        try:
            result = runner.run(url, work / 'output', 'composition',
                                {'ALEMBIC_CHECK': runner.windows(repo / 'tests/composition-browser.mjs')})
            print(result.stdout)
            print(result.stderr, file=sys.stderr)
            return result.returncode
        finally:
            process.terminate()
            process.wait(timeout=5)
            marker = location(project) / 'holder.pid'
            if marker.exists():
                for row in rpc(project, 'list'):
                    if not row['exited']:
                        try:
                            rpc(project, 'kill', id=row['id'])
                        except RuntimeError:
                            pass
                os.kill(int(marker.read_text()), signal.SIGTERM)


if __name__ == '__main__':
    sys.exit(main())
