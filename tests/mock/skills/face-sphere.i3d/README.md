A simple SVG smile painted onto a yellow sphere.

Open this directory as a 3D node. The default render is `sphere.glb`; its PNG
texture is embedded. The “Smile” playback holds the static view for 3 seconds.

Editable sources:
- `face.svg`: the finished paint, without UV guides.
- `uv-layout.svg`: the actual sphere mesh's exported UV layout.
- `face.png`: the SVG rasterized at 1024 × 1024.
- `sphere.blend`: compressed scene, including packed texture and front camera.
- `generate.py`: Blender geometry, UV export, SVG authoring and material setup.
- `frame_glb.py`: restores the front camera to the shared exporter's GLB.

To regenerate, run `generate.py` in Blender, rasterize `face.svg` to `face.png`
with a real browser, then run the Blender script with `-- --finish`. Use the
repository's `render/blender/bake.py` to render/export `sphere.blend` on the GPU,
and finally run `python frame_glb.py`. `sphere.png` is the GPU proof image.

Validation: CUDA proof rendered on an NVIDIA RTX 5060 Ti; the actual WebGPU
viewer was inspected with the face upright and visible. GLB contains one mesh,
UVs, an embedded PNG, and a front camera. The shared authored-node browser check
exercised the 3-second playback and replay, but its exact reset screenshot
comparison failed (the playback menu remained visible and some scene pixels
differed). An earlier run hit a transient WebGPU allocation error. No custom
shaders are used; a separate WebGL2 check was not run.
