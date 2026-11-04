"""Install the source autoload and export with pinned, single-threaded WebGL2 templates."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('project', type=Path)
p.add_argument('entry', type=Path, help='Loose .html export, outside the Godot source directory')
args = p.parse_args()
project = args.project.resolve(strict=True)
entry = args.entry.resolve()
if entry.suffix != '.html' or entry.is_relative_to(project):
    p.error('Use an .html output outside the source directory')
temp = Path(os.environ['TMPDIR']).resolve()
deps = Path(os.environ['ALEMBIC_DEPS']) if os.environ.get('ALEMBIC_DEPS') else None
godot = str(deps / 'godot/godot') if deps else shutil.which('godot')
if not godot: p.error('Missing godot; install it on PATH or set ALEMBIC_DEPS')
templates = deps / 'godot-templates/godot-templates.tpz' if deps else next((Path(d) / 'godot-templates.tpz'
    for d in os.get_exec_path() if (Path(d) / 'godot-templates.tpz').is_file()), None)
if not templates or not templates.is_file():
    p.error('Missing godot-templates.tpz; put it on PATH or set ALEMBIC_DEPS')
here = Path(__file__).resolve().parent
config = project / 'project.godot'
source = config.read_text()
binding = 'AlembicRender="*res://alembic-render.gd"\n'
if 'AlembicRender=' in source and binding.strip() not in source:
    p.error('AlembicRender autoload already belongs to another source')
if binding.strip() not in source:
    source = source.replace('[autoload]', '[autoload]\n' +
        binding) if '[autoload]' in source else source + '\n[autoload]\n' + binding
    config.write_text(source)
shutil.copyfile(here / 'runtime.gd', project / 'alembic-render.gd')
entry.parent.mkdir(parents=True, exist_ok=True)
presets = project / 'export_presets.cfg'
original = presets.read_bytes() if presets.exists() else None
with tempfile.TemporaryDirectory(prefix='godot-export-', dir=temp) as directory:
    work = Path(directory)
    with zipfile.ZipFile(templates) as archive:
        archive.extract('templates/web_nothreads_release.zip', work)
    template = work / 'templates/web_nothreads_release.zip'
    presets.write_text((
'[preset.0]\nname="Alembic Web"\nplatform="Web"\nexport_filter="all_r'
'esources"\ninclude_filter=""\nexclude_filter=""\n\n[preset.0.options]'
'\ncustom_template/release='
) + json.dumps(str(template)) + '\nvariant/thread_support=false\nhtml/export_icon=false\nhtml/canvas_resize_policy=2\n')
    env = dict(os.environ, XDG_DATA_HOME=str(temp / 'data'), XDG_CONFIG_HOME=str(temp / 'config'), XDG_CACHE_HOME=str(
        temp / 'cache'))
    try:
        result = subprocess.run([godot, '--headless', '--path', str(project), '--export-release',
            'Alembic Web', str(entry)], env=env, check=True, timeout=100, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True)
        print(result.stdout)
        if 'SCRIPT ERROR:' in result.stdout or 'ERROR:' in result.stdout:
            raise RuntimeError('Godot export reported errors')
    finally:
        if original is None:
            presets.unlink(missing_ok=True)
        else:
            presets.write_bytes(original)
shutil.copyfile(here.parent / 'bridge.js', entry.parent / 'render-bridge.js')
shutil.copyfile(here / 'bridge.js', entry.parent / 'alembic-bridge.js')
shutil.copyfile(here.parents[1] / 'frontend/public/assets/play/interaction.js', entry.parent / 'interaction.js')
settings = re.search('const GODOT_CONFIG = (.*);', entry.read_text()).group(1)
wasm = entry.with_suffix('.wasm')
parts = []
with wasm.open('rb') as stream:
    while (chunk := stream.read(8 * 1024 * 1024)):
        part = wasm.with_name(wasm.name + '.' + str(len(parts)))
        part.write_bytes(chunk)
        parts.append(part.name)
wasm.unlink()
entry.write_text((
'<!doctype html><style>html,body,canvas{margin:0;width:100%;height'
':100%;display:block;overflow:hidden}</style><canvas id="canvas" t'
'abindex="0"></canvas><script src="'
) + entry.stem + (
'.js"></script><script type="module">import {bindGodot,requireGPU,'
'wasmParts} from "./alembic-bridge.js";try{wasmParts('
) + json.dumps(wasm.name) + ',' + json.dumps(parts) +
    ');requireGPU(document.querySelector("canvas"));const engine=new Engine(' + settings + (
');bindGodot(engine);await engine.startGame({});}catch(error){pare'
'nt.postMessage({type:"alembic.web.failure",error:String(error)},l'
'ocation.origin)}</script>'
))
print('Godot WebGL2 export: ' + str(entry))
