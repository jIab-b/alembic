"""Retain the authored front framing after the repository bake.py GLB export.

The shared exporter omits cameras; add only a standard glTF camera and preserve
its exported mesh, material, image and binary chunk byte for byte.
"""
from pathlib import Path
import json
import math
import struct

path = Path(__file__).resolve().with_name('sphere.glb')
data = path.read_bytes()
length = struct.unpack_from('<I', data, 12)[0]
doc = json.loads(data[20:20+length])
if not doc.get('cameras'):
    doc['cameras'] = [{'name': 'Front view', 'type': 'perspective',
                       'perspective': {'yfov': 2*math.atan(36/(2*52)), 'znear': .01, 'zfar': 100}}]
    node = len(doc['nodes'])
    doc['nodes'].append({'name': 'Front view', 'camera': 0, 'translation': [0, 0, 5.1],
                        'extras': {'alembic_focus_distance': 5.1, 'alembic_navigation_speed': 1}})
    doc['scenes'][doc.get('scene', 0)]['nodes'].append(node)
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    tail = data[20+length:]
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 20+len(encoded)+len(tail)) +
                     struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + tail)
