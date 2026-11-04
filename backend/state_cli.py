"""CLI state capture/replay uses the same server and Windows UI harness as live peers."""
import importlib.machinery, json, os, random, re
from pathlib import Path
from common import connection, launch_url, REPO, request, start

def run(args, root):
    states = REPO / 'tests/states'
    frozen = REPO / 'tests/frozen'
    name = getattr(args, 'name', '')
    if name and (not re.fullmatch('[A-Za-z][\\w-]{0,63}', name)):
        raise ValueError('Invalid state name')
    if args.command == 'unfreeze':
        (frozen / (name + '.json')).unlink()
        return
    info = connection(root) if args.command == 'fuzz' or (args.command == 'state' and args.action == 'save') else None
    peer_info = {**info, 'base': info.get('peer') or info['base'], 'token': 'mock' if info.get('peer') else info[
        'token']} if info else None
    if args.command == 'fuzz':
        names = sorted((p.stem for p in states.glob('*.json')))
        rng = random.Random(args.seed)
        sequence = [rng.choice(names) for _ in range(args.runs)]
        outcomes = []
        for state in sequence:
            request(peer_info, '/al/state', dict(state=state))
            recorded = json.loads((states / (state + '.json')).read_text())
            for action in recorded['steps']:
                if action['kind'] != 'backend':
                    continue
                route = action['operation'] if action['operation'].startswith('/') else '/w/project/' + action[
                    'operation']
                try:
                    request(peer_info, route)
                    status = 200
                except __import__('urllib.error', fromlist=['HTTPError']).HTTPError as error:
                    status = error.code
                if status != action.get('status', 200):
                    raise RuntimeError('Fuzz reply drift at ' + state)
                outcomes.append(dict(state=state, route=route, status=status))
        print(json.dumps(dict(seed=args.seed, sequence=sequence, outcomes=outcomes)))
        return
    if args.command == 'state' and args.action == 'save':
        log = json.loads(request(info, '/al/log'))
        tree = {}
        for message in log:
            body = message.get('body', {})
            if isinstance(body, dict) and body.get('route') == '/w/project/file' and (body.get('method') == 'GET'):
                from urllib.parse import urlencode
                path = body['query']['path']
                try:
                    value = request(info, '/w/project/file?' + urlencode(dict(path=path)))
                    if len(value) < 65536:
                        tree[path] = value.decode()
                except (UnicodeError, OSError):
                    pass
        value = dict(name=name, tree=tree, replies={}, terminal=[], steps=[])
        try:
            value.update(json.loads(request(info, '/al/state')))
        except OSError:
            pass
        value.update(name=name, tree=value['tree'] or tree)
        (states / (name + '.json')).write_text(json.dumps(value, separators=(',', ':')) + '\n')
        print('Saved ' + name)
        return
    if not (states / (name + '.json')).is_file():
        raise ValueError('State not found')
    import tempfile, time
    runner = importlib.machinery.SourceFileLoader('windows_run', str(REPO / 'tests/windows-run.py')).load_module()
    out = Path(os.environ['TMPDIR']) / ('report-' + name)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as temporary:
        replay = Path(temporary) / 'project'
        replay.mkdir()
        peer, info = start(replay, '--node', 'mock.iframe', '--state', str(states / (name + '.json')))
        try:
            url_file = out / 'url'
            url_file.write_text(launch_url(info))
            request(info, '/workspaces')
            time.sleep(0.2)
            result = runner.run(url_file, out, 'state', dict(ALEMBIC_STATE=name))
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)
        finally:
            peer.terminate()
            peer.wait(timeout=5)
    summary = json.loads((out / 'state.json').read_text())
    if args.command == 'freeze':
        frozen.mkdir(exist_ok=True)
        (frozen / (name + '.json')).write_text(json.dumps(dict(state=name, dom=summary['dom'], pixels=summary['pixels'],
            tolerance=12, maxChanged=0.02), separators=(',', ':')) + '\n')
        print('Frozen ' + name)
    else:
        print('Report ' + str(out / 'state.json'))
