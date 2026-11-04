Run: python3 render/blender/bake.py /project/model.blend
Requires TMPDIR; set ALEMBIC_DEPS for pinned tools, otherwise tools must be on PATH.
Uses blender-cuda; --device CUDA|OPTIX, --size and --samples bound the proof render.
Writes model.glb and model.png beside the retained source; no CPU fallback.
Declare the GLB with: render<TAB>model<TAB>glb<TAB>model.glb
Uses Blender's glTF exporter; arbitrary procedural shaders are not texture-baked.
