"""Regenerate the host's opaque playback scripts from the editable source."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
source = (root / 'animate.js').read_text()
rows = ['playbacks-index\t2']
for name, label, duration, shooting in [('idle', 'Idle', '8', False), ('shooting', 'Shooting', '6.4', True)]:
    script = f'const shooting = {json.dumps(shooting)};\n' + source
    rows.append('\t'.join(['scenario', name, label, 'main', duration, 'none', json.dumps(script)]))
(root / 'playbacks.txt').write_text('\n'.join(rows) + '\n')
