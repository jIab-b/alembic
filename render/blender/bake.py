"""Export a .blend beside its source and render a CUDA/OptiX proof. No CPU fallback."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--samples', type=int, default=32)
    parser.add_argument('--size', type=int, default=256)
    parser.add_argument('--device', choices=['OPTIX', 'CUDA'], default='CUDA')
    parser.add_argument('--seconds', type=int, default=0, help='Optional bounded GPU benchmark, 0..20 seconds')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else None)
    source = args.source.resolve(strict=True)
    if (source.suffix != '.blend' or not 1 <= args.samples <= 256 or (not 16 <= args.size <= 2048) or (
        not 0 <= args.seconds <= 20)):
        parser.error('Expected .blend, 1..256 samples, 16..2048 pixels')
    if '--' not in sys.argv:
        blender = str(Path(os.environ['ALEMBIC_DEPS']) / 'blender-cuda/blender') if os.environ.get(
            'ALEMBIC_DEPS') else shutil.which('blender')
        if not blender: parser.error('Missing blender; install it on PATH or set ALEMBIC_DEPS')
        temp = Path(os.environ['TMPDIR']).resolve()
        env = dict(os.environ, XDG_CACHE_HOME=str(temp / 'cache'), XDG_CONFIG_HOME=str(temp / 'config'),
            CUDA_CACHE_PATH=str(temp / 'cuda'))
        command = [blender, '--background', '--factory-startup', str(source),
            '--python-exit-code', '1', '--python', str(Path(__file__).resolve()), '--', *sys.argv[1:]]
        subprocess.run(command, check=True, timeout=110, env=env)
        return
    import bpy
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = args.device
    prefs.get_devices()
    devices = [d for d in prefs.devices if d.type == args.device]
    if not devices:
        raise RuntimeError(f'No {args.device} Cycles device; refusing CPU render')
    for device in prefs.devices:
        device.use = device.type == args.device
    scene = bpy.context.scene
    if not scene.camera:
        raise RuntimeError('The authored scene needs a camera')
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = False
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(source.with_suffix('.png'))
    until = time.monotonic() + args.seconds
    while True:
        bpy.ops.render.render()
        if time.monotonic() >= until:
            break
    bpy.data.images['Render Result'].save_render(scene.render.filepath)
    bpy.ops.export_scene.gltf(filepath=str(source.with_suffix('.glb')), export_format='GLB')
    print(json.dumps({'glb': str(source.with_suffix('.glb')), 'image': scene.render.filepath, 'backend': args.device,
        'devices': [d.name for d in devices]}), flush=True)
if __name__ == '__main__':
    main()
