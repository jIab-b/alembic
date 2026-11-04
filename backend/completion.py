"""Project-local completion receipts; no running relay is needed."""
import json, re, shlex
from pathlib import Path

RULE = (f'When an Alembic prompt is finished, run `{shlex.quote(str(Path(__file__).resolve().with_name("al")))} '
        'done <details-file>` using the details path in that prompt. '
        f'Skills are in `{Path(__file__).resolve().parents[1] / "skills"}/`. Read only the one that fits the task.')

def done(details):
    path = Path(details).resolve()
    pattern = r'/\.alembic/selections/[\w-]+/[\w-]+-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$'
    if not re.search(pattern, str(path)):
        raise ValueError('Expected .alembic/selections/<canvas>/<selection>-<request-UUID>.json')
    if not path.exists(): return  # Already acknowledged, including deleted jobs.
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or data.get('version') != 1: raise ValueError('Invalid Alembic prompt details')
    path.with_suffix('.done').write_text('done\n')
    path.unlink()
