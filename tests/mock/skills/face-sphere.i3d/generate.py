"""Blender: create mesh/UV/SVG; rasterize face.svg, then run again with -- --finish.

Geometry authoring does not render. Use the repository bake.py for GPU proof/GLB.
"""
from pathlib import Path
import math
import sys
import bpy
from mathutils import Vector
from mathutils.geometry import barycentric_transform

ROOT = Path(__file__).resolve().parent
SIZE = 1024

if '--finish' in sys.argv:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'sphere.blend'))
    material = bpy.data.materials['SVG face']
    image = bpy.data.images.load(str(ROOT / 'face.png'), check_existing=True)
    image.colorspace_settings.name = 'sRGB'
    image.pack()
    nodes = material.node_tree.nodes
    texture = nodes.new('ShaderNodeTexImage')
    texture.name = 'Editable SVG baked to PNG'
    texture.image = image
    material.node_tree.links.new(texture.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'sphere.blend'), compress=True)
else:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1)
    sphere = bpy.context.object
    sphere.name = 'Smiling sphere'
    for polygon in sphere.data.polygons:
        polygon.use_smooth = True
    bpy.ops.uv.export_layout(filepath=str(ROOT / 'uv-layout.svg'), export_all=True,
                             mode='SVG', size=(SIZE, SIZE), opacity=0.12)

    # Ray hits interpolate the actual mesh UVs. This accounts for its seam,
    # orientation, tessellation and SVG's downward-positive y axis.
    mesh = sphere.data
    uv = mesh.uv_layers.active.data
    def paint_point(x, z):
        hit, position, normal, face = sphere.ray_cast(Vector((x, -3, z)), Vector((0, 1, 0)))
        assert hit
        polygon = mesh.polygons[face]
        loops = list(polygon.loop_indices)
        for j in range(1, len(loops)-1):
            tri = [loops[0], loops[j], loops[j+1]]
            points = [mesh.vertices[mesh.loops[k].vertex_index].co for k in tri]
            weights = barycentric_transform(position, *points,
                Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
            if min(weights) >= -0.0001:
                coord = sum((uv[k].uv * weights[n] for n, k in enumerate(tri)), Vector((0, 0)))
                return coord.x * SIZE, (1-coord.y) * SIZE
        raise RuntimeError('No UV triangle contains the ray hit')

    def path(points):
        coords = [paint_point(x, z) for x, z in points]
        return 'M ' + ' L '.join(f'{x:.3f},{y:.3f}' for x, y in coords) + ' Z'

    def oval(cx, cz, rx, rz):
        return path([(cx+rx*math.cos(i*math.tau/80), cz+rz*math.sin(i*math.tau/80))
                     for i in range(80)])

    # A round-capped smiling stroke, authored in front-view mesh coordinates.
    line = [Vector((-.36+.72*i/80, -.17-.21*math.sin(math.pi*i/80))) for i in range(81)]
    normals = []
    for i, p in enumerate(line):
        direction = (line[min(i+1, 80)]-line[max(0, i-1)]).normalized()
        normals.append(Vector((-direction.y, direction.x)))
    thickness = .021
    outline = [p+n*thickness for p, n in zip(line, normals)]
    end = math.atan2(normals[-1].y, normals[-1].x)
    outline += [line[-1]+Vector((math.cos(end-math.pi*i/16), math.sin(end-math.pi*i/16)))*thickness for i in range(1, 17)]
    outline += [p-n*thickness for p, n in reversed(list(zip(line, normals)))]
    end = math.atan2(-normals[0].y, -normals[0].x)
    outline += [line[0]+Vector((math.cos(end-math.pi*i/16), math.sin(end-math.pi*i/16)))*thickness for i in range(1, 17)]
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Simple smile — sphere UV paint</title>
  <desc>Two eyes and a smile, mapped through the actual sphere UV triangles. The layout guides are in uv-layout.svg.</desc>
  <rect width="1024" height="1024" fill="#ffd45a"/>
  <g fill="#29251f">
    <path id="left-eye" d="{oval(-.29, .23, .065, .102)}"/>
    <path id="right-eye" d="{oval(.29, .23, .065, .102)}"/>
    <path id="smile" d="{path(outline)}"/>
  </g>
</svg>
'''
    (ROOT / 'face.svg').write_text(svg)
    material = bpy.data.materials.new('SVG face')
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (1, .66, .1, 1)
    bsdf.inputs['Roughness'].default_value = .72
    bsdf.inputs['Specular IOR Level'].default_value = .25
    sphere.data.materials.append(material)

    bpy.ops.object.camera_add(location=(0, -5.1, 0))
    camera = bpy.context.object
    camera.name = 'Front view'
    camera.rotation_euler = (Vector((0, 0, 0))-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = 52
    camera['alembic_focus_distance'] = 5.1
    camera['alembic_navigation_speed'] = 1
    bpy.context.scene.camera = camera
    bpy.ops.object.light_add(type='AREA', location=(-3, -4, 5))
    light = bpy.context.object
    light.data.energy = 450
    light.data.shape = 'DISK'
    light.data.size = 5
    light.rotation_euler = (-light.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.world.color = (.24, .24, .24)
    bpy.context.scene.view_settings.view_transform = 'Standard'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'sphere.blend'), compress=True)
    print('Created actual UV layout and editable SVG; front-center UV:', paint_point(0, 0))
