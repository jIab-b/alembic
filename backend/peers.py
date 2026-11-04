"""State-file peers share the live routes but never execute or touch project files."""
import base64, json
from pathlib import Path

class Peers:

    def __init__(self, state):
        self.load(state)

    def load(self, state):
        self.state = json.loads(Path(state).read_text())
        self.output = '\r\n'.join(self.state['terminal']) + '\r\n'

    def session(self, op, **body):
        if op == 'list':
            return [dict(id='mock', pid=1, agent='codex', attachable=True, external=False, active=True, program=dict(pid=1, name='codex'))]
        if op in ('default', 'focus', 'create'):
            return 'mock'
        if op == 'active':
            return True
        if op == 'read':
            return (dict(data=base64.b64encode(self.output[body.get('cursor', 0):].encode()).decode(), cursor=len(
                self.output), exited=False))
        if op == 'input' and base64.b64decode(body['data']).startswith(b'export ALEMBIC_TERMINAL_ID='):
            return True
        if op == 'input':
            self.output = (self.output + base64.b64decode(body['data']).decode(errors='replace'))[-131072:]
        return True

    def read(self, name, node):
        if name == node + '/index.html':
            return b'<!doctype html><canvas width="400" height="240"></canvas>'
        if name in self.state['tree']:
            return self.state['tree'][name].encode()
        raise FileNotFoundError(name)
