"""Tiny authored Blender fixture, or its measured OpenGL workload."""
import json
import sys
import time
from pathlib import Path
import bpy

output = Path(sys.argv[sys.argv.index('--') + 1])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()
bpy.context.object.name = 'box'
material = bpy.data.materials.new('blue')
material.diffuse_color = (0.15, 0.55, 0.9, 1)
bpy.context.object.data.materials.append(material)
bpy.ops.object.camera_add(location=(3, 2, 4))
camera = bpy.context.object
from mathutils import Vector
camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=(2, 1, 4))
bpy.context.object.data.energy = 800
scene = bpy.context.scene
scene.world.color = (0.15, 0.15, 0.15)
if '--opengl' in sys.argv:
    import gpu
    renderer = gpu.platform.renderer_get()
    if not renderer or any(s in renderer.lower() for s in ['llvmpipe', 'lavapipe', 'software', 'swiftshader', 'basic render', 'warp']):
        raise RuntimeError('Hardware OpenGL unavailable: ' + str(renderer))
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    start = time.monotonic()
    frames = 0
    while time.monotonic() - start < 10:
        bpy.ops.render.render()
        frames += 1
    print(json.dumps({'renderer': renderer, 'frames': frames}), flush=True)
    bpy.ops.wm.quit_blender()
else:
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
