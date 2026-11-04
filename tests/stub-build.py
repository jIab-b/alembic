"""Register a test adapter in an owned copy; product frontend sources are untouched."""
import os
from pathlib import Path
import shutil
import subprocess

repo = Path(__file__).resolve().parents[1]
copy = Path(os.environ['TMPDIR']) / 'clean'
assert copy.is_dir()
registry = copy / 'render/registry.js'
registry.write_text(registry.read_text() + "\nregistry.push({formats:['stub2d'],port:'i2d',extensions:['html']," +
    "kind:'app',entry:['test-stub','stub/runtime.js'],loader:()=>import('./stub/runtime.js')});\n")
(copy / 'render/stub').mkdir(exist_ok=True)
shutil.copy2(repo / 'tests/fixtures/render/browser-stub.js', copy / 'render/stub/runtime.js')
for name, fmt in [('stub.i2d', 'stub2d'), ('broken.i2d', 'stub2d'), ('unsupported.i3d', 'godot')]:
    node = copy / 'tests/mock' / name
    node.mkdir(exist_ok=True)
    shutil.copy2(repo / 'tests/mock/i2d/flat.i2d/.node.txt', node / '.node.txt')
    (node / 'exports.txt').write_text(f'exports-index\t1\nrender\tmain\t{fmt}\tindex.html\n')
    html = '<!doctype html>' + ('<html data-broken=1>' if name == 'broken.i2d' else '')
    (node / 'index.html').write_text(html + '<script type="module" src="/assets/play/test-stub.js"></script>')
    (node / 'playbacks.txt').write_text('playbacks-index\t2\nscenario\tcolor\tColor\tmain\t1\tnone\t"{}"\n')
subprocess.run(['npm', '--workspace', 'frontend', 'run', 'build'], cwd=copy, check=True)
