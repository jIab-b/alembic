"""Run with installed Blender --background --python source/build_model.py.
Creates geometry, exports its actual UVs, paints that atlas and rasterizes via
the installed librsvg/Cairo libraries. No 3D rendering happens in this script.
Then use the repository render/blender/bake.py for the GPU proof and GLB.
"""
import bpy, json, math, random, ctypes as C
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
SOURCE = ROOT / 'source'
random.seed(27)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
objects = []
SIZE = 2048
SELECTED_RUNESTONES = set(range(18,24))
DARK_SIDE_TILE = 38

def uvrect(tile):
    x, y = (tile % 8)*256+12, (tile//8)*256+12
    return x, y, 232, 232

def uvpoint(tile, u, v):
    x,y,w,h=uvrect(tile)
    return ((x+u*w)/SIZE, 1-(y+(1-v)*h)/SIZE)

def finish(obj, tile, kind='stone', rune=-1, bevel=.035):
    obj['kind'],obj['rune']=kind,rune
    if not obj.data.uv_layers: obj.data.uv_layers.new(name='PaintUV')
    uv=obj.data.uv_layers.active
    # Primitive islands reuse a padded atlas swatch; arch fronts are overridden.
    for poly in obj.data.polygons:
        coords=[uv.data[li].uv.copy() for li in poly.loop_indices]
        lo=[min(c[k] for c in coords) for k in [0,1]]
        span=[max(c[k] for c in coords)-lo[k] for k in [0,1]]
        for j,li in enumerate(poly.loop_indices):
            old=coords[j]
            u=(old.x-lo[0])/max(span[0],.000001)
            v=(old.y-lo[1])/max(span[1],.000001)
            # The circular seal occupies a complete circular cap island; its
            # narrow rim uses plain stone instead of a stretched seal fragment.
            face_tile=32 if tile==35 and abs(poly.normal.z)<.5 else tile
            uv.data[li].uv=uvpoint(face_tile,u,v)
    if bevel:
        mod=obj.modifiers.new('Chipped stone edge' if kind=='stone' else 'Edge glint','BEVEL')
        mod.width=bevel;mod.segments=2
        mod=obj.modifiers.new('Weighted face normals','WEIGHTED_NORMAL')
        mod.keep_sharp=True
    objects.append(obj)
    return obj

def box(name,loc,scale,tile=32,kind='stone',bevel=.05):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.name=name;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,tile,kind,bevel=bevel)

def cylinder(name,loc,radius,depth,tile=32,kind='stone',vertices=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    o=bpy.context.object;o.name=name
    return finish(o,tile,kind,bevel=.025)

def torus(name,radius,tube,y,z,kind='gold'):
    bpy.ops.mesh.primitive_torus_add(major_segments=96,minor_segments=8,
        location=(0,y,z),rotation=(math.pi/2,0,0),major_radius=radius,minor_radius=tube)
    o=bpy.context.object;o.name=name
    return finish(o,33 if kind=='gold' else 34,kind,bevel=0)

# Each annular wedge has a deliberately rectangular front UV island: U travels
# clockwise around the ring and V travels outwards. Art uses this exact mapping.
for i in range(24):
    a0=2*math.pi*i/24+.012;a1=2*math.pi*(i+1)/24-.012
    verts=[]
    for y in [-.43,.43]:
        for r in [1.99,2.58]:
            for j in range(5):
                a=a0+(a1-a0)*j/4
                verts.append((r*math.sin(a),y,3.25+r*math.cos(a)))
    faces=[];maps=[]
    for j in range(4):
        faces.extend([(j,j+1,j+6,j+5),(j+10,j+15,j+16,j+11),
                      (j+5,j+6,j+16,j+15),(j,j+10,j+11,j+1)])
        maps.extend([[(j/4,0),((j+1)/4,0),((j+1)/4,1),(j/4,1)],
                     [(j/4,0),(j/4,1),((j+1)/4,1),((j+1)/4,0)],
                     [(0,0),(1,0),(1,1),(0,1)],[(0,0),(0,1),(1,1),(1,0)]])
    faces.extend([(0,5,15,10),(4,14,19,9)])
    maps.extend([[(0,0),(1,0),(1,1),(0,1)]]*2)
    mesh=bpy.data.meshes.new('Radial stone UV mesh');mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(f'Runestone_{i:02d}',mesh);bpy.context.collection.objects.link(o)
    finish(o,i,'stone',i,.026)
    for k,p in enumerate(mesh.polygons):
        for li,(u,v) in zip(p.loop_indices,maps[k]):
            side_tile=DARK_SIDE_TILE if i in SELECTED_RUNESTONES else 32
            mesh.uv_layers.active.data[li].uv=uvpoint(i if k%4<2 and k<16 else side_tile,u,v)
    # Recalculate the authored mesh normals before evaluation/export.
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False)

cylinder('Lower twelve-sided basalt dais',(0,0,.14),3.65,.28,vertices=12)
cylinder('Dais brass seam',(0,0,.30),3.49,.055,33,'gold',12)
cylinder('Raised ritual platform',(0,0,.45),3.42,.25,35,vertices=12)
cylinder('Central engraved seal',(0,0,.585),1.75,.035,35,vertices=64)
for i in range(3):
    box(f'Processional step {i+1}',(0,-3.15+.38*i,.09+.09*i),(2.8-.15*i,1.04,.18+.18*i))
    box(f'Step brass nosing {i+1}',(0,-3.66+.38*i,.19+.18*i),(2.68-.15*i,.024,.025),33,'gold',.009)
for side in [-1,1]:
    x=side*2.75
    box('Buttress foot',(x,0,.80),(.98,1.18,.44))
    o=box('Tapered guardian obelisk',(x,.05,1.73),(.59,.73,1.65),36)
    o.rotation_euler[1]=side*-.065
    box('Obelisk gold collar',(x,.05,2.45),(.70,.83,.12),33,'gold')
    box('Obelisk capital',(x,.05,2.59),(.86,.96,.18))
    cylinder('Crystal socket',(x,.05,2.75),.30,.20,33,'gold',8)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,.05,3.17))
    o=bpy.context.object;o.name='Aether crystal';o.scale=(.27,.27,.58)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    finish(o,34,'crystal',bevel=0)
    box('Ring support',(side*1.55,.12,1.05),(.61,.85,1.0))
torus('Inner brass channel',1.968,.045,-.405,3.25)
torus('Outer gold binding',2.625,.026,-.22,3.25)
torus('Rear brass channel',2.04,.035,.46,3.25)
for i in range(12):
    a=2*math.pi*i/12
    o=box('Brass radial clasp',(2.60*math.sin(a),-.02,3.25+2.60*math.cos(a)),(.15,1.02,.14),33,'gold',.018)
    o.rotation_euler[1]=a
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.09,location=(2.60*math.sin(a),-.55,3.25+2.60*math.cos(a)))
    finish(bpy.context.object,34,'crystal',bevel=0).name='Turquoise rivet'
o=box('Crown keystone',(0,0,5.91),(.68,.97,.48),37);o.rotation_euler[1]=math.pi/4
for i in range(9):
    a=i*2.399
    x=math.cos(a)*(2.8+(i%3)*.28);y=math.sin(a)*(2.4+(i%2)*.27)
    if y< -2 and abs(x)<1.6: continue
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,y,.61))
    o=bpy.context.object;o.name='Weathered rubble';o.scale=(.18+(i%3)*.055,.23,.12)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);finish(o,32,bevel=0)

# Export the actual model UV map, not a hand-drawn guide approximation.
bpy.ops.object.select_all(action='DESELECT')
for o in objects: o.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.export_layout(filepath=str(SOURCE/'uv-layout.svg'),export_all=True,
    modified=False,mode='SVG',size=(SIZE,SIZE),opacity=.18)
bpy.ops.object.mode_set(mode='OBJECT')
(SOURCE/'uv-islands.json').write_text(json.dumps({str(i):uvrect(i) for i in list(range(24))+list(range(32,39))},indent=2))

header=f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">'
paint=[header,'<defs><linearGradient id="stone" x2=".8" y2="1"><stop stop-color="#596773"/><stop offset=".48" stop-color="#323e4b"/><stop offset="1" stop-color="#202c38"/></linearGradient><linearGradient id="charcoal" x2=".8" y2="1"><stop stop-color="#272e38"/><stop offset=".48" stop-color="#171e28"/><stop offset="1" stop-color="#0e141d"/></linearGradient><linearGradient id="brass" x2=".7" y2="1"><stop stop-color="#d9b877"/><stop offset=".4" stop-color="#9c7440"/><stop offset="1" stop-color="#4f4835"/></linearGradient></defs><rect width="2048" height="2048" fill="#26303c"/>']
mask=[header,'<rect width="2048" height="2048" fill="black"/>']
glyphs=['M 100 65 L 153 101 L 100 139 M 128 48 L 128 185 M 101 159 L 128 185 L 155 159',
 'M 92 179 L 128 59 L 164 179 M 106 132 L 150 132 M 112 93 L 144 93',
 'M 94 72 L 159 72 L 112 128 L 159 181 L 94 181 M 128 46 L 128 208',
 'M 128 48 L 128 200 M 128 83 L 164 111 L 128 139 L 92 111 Z M 103 172 L 153 172',
 'M 94 61 L 94 185 M 94 122 L 156 72 L 156 182 M 94 157 L 156 110',
 'M 128 46 L 91 107 L 128 165 L 165 107 Z M 128 165 L 128 204 M 106 191 L 150 191',
 'M 94 80 L 128 50 L 162 80 M 128 50 L 128 199 M 94 125 L 128 153 L 162 125',
 'M 92 70 L 164 70 L 128 125 L 164 180 L 92 180 M 106 205 L 150 205']
# Six closed celestial knots replace the selected upper-left arc's stave runes.
# Their paths feed both the color painting and the emission mask below.
selected_glyphs={
 18:'M128 52L178 128L128 204L78 128Z M128 82L156 128L128 174L100 128Z M66 128H190 M128 38V64 M128 192V218',
 19:'M128 61A55 67 0 1 0 128 195A55 67 0 1 0 128 61 M128 91L157 128L128 165L99 128Z M128 40V91 M128 165V216 M62 128H84 M172 128H194',
 20:'M128 47L172 95L128 143L84 95Z M128 113L172 161L128 209L84 161Z M60 128H96 M160 128H196 M128 78V112 M128 144V178',
 21:'M128 51L184 89V167L128 205L72 167V89Z M128 83L156 128L128 173L100 128Z M72 89L100 128L72 167 M184 89L156 128L184 167 M128 51V83 M128 173V205',
 22:'M128 72A56 56 0 1 0 128 184A56 56 0 1 0 128 72 M128 40V99 M128 157V216 M40 128H99 M157 128H216 M128 99L157 128L128 157L99 128Z',
 23:'M128 44L177 88L128 132L79 88Z M128 124L177 168L128 212L79 168Z M79 88L58 128L79 168 M177 88L198 128L177 168 M102 88H154 M102 168H154'
}
for tile in list(range(24))+list(range(32,39)):
    x,y,w,h=uvrect(tile);ox=x-12;oy=y-12
    dark=tile in SELECTED_RUNESTONES or tile==DARK_SIDE_TILE
    finish_id='brass' if tile==33 else 'charcoal' if dark else 'stone'
    paint.append(f'<g transform="translate({ox} {oy})"><rect width="256" height="256" fill="url(#{finish_id})"/>')
    # Authored polygonal mineral flecks, hairline fractures and edge abrasion.
    for j in range(115):
        px=random.randrange(256);py=random.randrange(256);s=random.randrange(1,13)
        palette=['#59656a','#0b1119','#3d454d','#344950'] if dark else ['#9eafa9','#131f2b','#707b78','#657b79']
        paint.append(f'<path d="M{px} {py}l{s} -2 3 {s/2} -{s+4} 2Z" fill="{random.choice(palette)}" opacity="{random.uniform(.05,.24):.2f}"/>')
    for j in range(5):
        py=random.randrange(20,235);px=random.choice([0,230])
        paint.append(f'<path d="M{px} {py}l19 8 -5 10 25 13 -4 8" fill="none" stroke="#14232c" stroke-width="2" opacity=".7"/>')
    paint.append(f'<path d="M18 237V18H237" fill="none" stroke="{"#63737c" if dark else "#9fafa6"}" stroke-width="3" opacity=".32"/><path d="M237 20V237H20" fill="none" stroke="{"#090f17" if dark else "#101d28"}" stroke-width="5" opacity=".7"/>')
    if tile<24 or tile in [36,37]:
        g=selected_glyphs.get(tile,glyphs[tile%len(glyphs)])
        paint.append('<path d="M42 72V42H72 M184 42H214V72 M214 184V214H184 M72 214H42V184" fill="none" stroke="#bd9a59" stroke-width="3" opacity=".75"/>')
        paint.append(f'<path d="{g}" fill="none" stroke="#101b24" stroke-width="15" stroke-linejoin="bevel"/><path d="{g}" fill="none" stroke="#689e9f" stroke-width="6" stroke-linejoin="bevel"/>')
        paint.append('<path d="M128 22l5 7 -5 7 -5 -7Z M128 220l5 7 -5 7 -5 -7Z" fill="#b9a271"/>')
        mask.append(f'<g transform="translate({ox} {oy})"><path d="{g}" fill="none" stroke="white" stroke-width="6" stroke-linejoin="bevel"/></g>')
    elif tile==35:
        paint.append('<g fill="none" stroke="#ae8c53" opacity=".8"><circle cx="128" cy="128" r="101" stroke-width="2"/><circle cx="128" cy="128" r="92"/><path d="M128 30L213 177H43Z M128 226L43 79H213Z" stroke-width="2"/><circle cx="128" cy="128" r="41"/><circle cx="128" cy="128" r="36"/></g>')
        for j in range(24):
            paint.append(f'<path transform="rotate({j*15} 128 128)" d="M128 25V34" stroke="#c5a264" stroke-width="2"/>')
    paint.append('</g>')
paint.append('</svg>');mask.append('</svg>')
(SOURCE/'stone-runes.svg').write_text(''.join(paint))
(SOURCE/'rune-emission.svg').write_text(''.join(mask))

def rasterize(svg,png):
    """Installed native 2D SVG rasterizer, independent of the 3D GPU path."""
    r=C.CDLL('librsvg-2.so.2');c=C.CDLL('libcairo.so.2');g=C.CDLL('libgobject-2.0.so.0')
    r.rsvg_handle_new_from_file.argtypes=[C.c_char_p,C.c_void_p];r.rsvg_handle_new_from_file.restype=C.c_void_p
    c.cairo_image_surface_create.argtypes=[C.c_int,C.c_int,C.c_int];c.cairo_image_surface_create.restype=C.c_void_p
    c.cairo_create.argtypes=[C.c_void_p];c.cairo_create.restype=C.c_void_p
    r.rsvg_handle_render_cairo.argtypes=[C.c_void_p,C.c_void_p];r.rsvg_handle_render_cairo.restype=C.c_int
    c.cairo_surface_write_to_png.argtypes=[C.c_void_p,C.c_char_p];c.cairo_surface_write_to_png.restype=C.c_int
    c.cairo_destroy.argtypes=[C.c_void_p];c.cairo_surface_destroy.argtypes=[C.c_void_p];g.g_object_unref.argtypes=[C.c_void_p]
    handle=r.rsvg_handle_new_from_file(str(svg).encode(),None)
    if not handle: raise RuntimeError('SVG load failed')
    surf=c.cairo_image_surface_create(0,SIZE,SIZE);ctx=c.cairo_create(surf)
    if not r.rsvg_handle_render_cairo(handle,ctx): raise RuntimeError('SVG rasterization failed')
    if c.cairo_surface_write_to_png(surf,str(png).encode()): raise RuntimeError('PNG write failed')
    c.cairo_destroy(ctx);c.cairo_surface_destroy(surf);g.g_object_unref(handle)

rasterize(SOURCE/'stone-runes.svg',ASSETS/'stone-runes.png')
rasterize(SOURCE/'rune-emission.svg',ASSETS/'rune-emission.png')
image=bpy.data.images.load(str(ASSETS/'stone-runes.png'));image.pack()
emission=bpy.data.images.load(str(ASSETS/'rune-emission.png'));emission.pack()
materials={}
for kind in ['stone','gold','crystal']:
    m=bpy.data.materials.new(kind.title()+' • baked SVG atlas');m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value=.82 if kind=='stone' else .32
    p.inputs['Metallic'].default_value=.78 if kind=='gold' else .1
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    if kind=='crystal':
        p.inputs['Base Color'].default_value=(.03,.55,.62,1)
        m.node_tree.links.remove(p.inputs['Base Color'].links[0])
        p.inputs['Emission Color'].default_value=(.02,.7,.8,1);p.inputs['Emission Strength'].default_value=1.8
    if kind=='stone':
        t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=emission
        m.node_tree.links.new(t.outputs['Color'],p.inputs['Emission Color']);p.inputs['Emission Strength'].default_value=.55
    materials[kind]=m
for o in objects:o.data.materials.clear();o.data.materials.append(materials[o['kind']])

# Export the evaluated (bevelled) model into a small, engine-independent mesh
# payload, using the very same UVs as the retained blend and portable GLB.
deps=bpy.context.evaluated_depsgraph_get();rows=[]
for o in objects:
    ev=o.evaluated_get(deps);m=ev.to_mesh();m.calc_loop_triangles()
    pos=[];norm=[];uv=[];indices=[]
    for tri in m.loop_triangles:
        for li in tri.loops:
            v=o.matrix_world@m.vertices[m.loops[li].vertex_index].co
            n=o.matrix_world.to_3x3()@m.corner_normals[li].vector;n.normalize()
            pos.extend([round(v.x,5),round(v.z,5),round(-v.y,5)])
            norm.extend([round(n.x,5),round(n.z,5),round(-n.y,5)])
            uv.extend([round(x,6) for x in m.uv_layers.active.data[li].uv]);indices.append(len(indices))
    rows.append(dict(name=o.name,kind=o['kind'],rune=o['rune'],positions=pos,normals=norm,uvs=uv,indices=indices))
    ev.to_mesh_clear()
(ASSETS/'geometry.json').write_text(json.dumps(rows,separators=(',',':')))

bpy.ops.object.camera_add(location=(8.6,-14,9.0));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,2.7))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=48
bpy.context.scene.camera=camera
for loc,energy,size,color in [((1,-7,10),1600,7,(.65,.82,1)),((-6,-2,5),1100,5,(.37,1,1)),((2,5,8),2000,5,(.7,.42,1))]:
    bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=energy;l.data.shape='DISK';l.data.size=size;l.data.color=color
    l.rotation_euler=(Vector((0,0,2))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.context.scene.world.color=(.045,.055,.08)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'teleporter.blend'),compress=True)
print(json.dumps({'objects':len(rows),'triangles':sum(len(r['indices'])//3 for r in rows),'atlas':[SIZE,SIZE]}))
