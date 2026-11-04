"""Replay all baselines with one disposable backend and one Windows browser at a time."""
import importlib.machinery,json,os,signal,subprocess,sys,tempfile,time
from pathlib import Path
repo=Path(__file__).resolve().parents[1];sys.path.insert(0,str(repo/'backend'))
from common import connection, launch_url, location, start
runner=importlib.machinery.SourceFileLoader('windows_run',str(repo/'tests/windows-run.py')).load_module()
with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as temp:
    root=Path(temp)/'project';root.mkdir()
    process, info=start(root,'--node','mock.iframe','--state',str(repo/'tests/states/iframe-success.json'))
    try:
        url_file=Path(temp)/'url';url_file.write_text(launch_url(info))
        for name in sys.argv[1:]:
            baseline=repo/'tests/frozen'/name;state=json.loads(baseline.read_text())['state']
            from state_cli import request
            info=connection(root);request(info,'/al/state',dict(state=state))
            extra=dict(ALEMBIC_BASELINE=runner.windows(baseline),ALEMBIC_STATE=state)
            if os.environ.get('ALEMBIC_STYLE_DRIFT'):extra['ALEMBIC_STYLE_DRIFT']='1'
            result=runner.run(url_file,root/'report','state',extra)
            if result.returncode:sys.exit(result.stdout+result.stderr)
        print('Frozen states replayed: '+str(len(sys.argv)-1))
    finally:process.terminate();process.wait(timeout=5)
