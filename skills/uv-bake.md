# SVG paint on a 3D model

Use this for UV texture authoring: get the model's UV layout as SVG, draw on that
layout, rasterize the drawing, then apply the texture using the same UV map.
Read [the contract](../docs/frontend-contract.md) and relevant
[3D examples](../tests/mock/i3d/), resolving links relative to this file.
Read [bake.py](../render/blender/bake.py) before running Blender: reuse its existing
GPU proof render/GLB export when needed; do not reimplement it. It is not a UV
layout exporter or SVG rasterizer. Do not change repository tools for one asset.

Find Blender with `command -v blender`, a configured executable or a bounded
search of installed tool locations/`ALEMBIC_DEPS` (read-only). Verify its version.
Do not hard-code a machine-specific Blender path. If missing, say so plainly.
The bake wrapper has its own dependency lookup; verify that separately. An
explicit discovered Blender can run that same script with `--python ... -- ...`.

1. Load/create the mesh, inspect its active UV map and unwrap if needed. Export
   that actual mesh's layout using Blender's `bpy.ops.uv.export_layout`, format SVG.
   Keep the layout, model, paint SVG and generation script with the project.
   Use modest tessellation: dense UV wire SVGs can outweigh the texture. Keep
   sources compact: compress retained .blend files and omit backups.
2. Draw SVG paths/shapes in the layout's coordinate system. Use UV island bounds
   and orientation, not a guessed sphere projection. SVG y increases downward;
   UV v increases upward. Keep guides out of the finished paint layer.
   Place a simple face away from seams/poles, and allow padding around islands.
3. Default to a retained PNG texture plus editable SVG. Browser SVG images can
   texture Babylon meshes, but Blender image textures and portable GLB exports
   need raster pixels; PNG gives one inspectable asset across both GPU paths.
   Rasterize once with an already installed SVG-capable tool or a real browser;
   no new dependencies. This authored 2D rasterization is not a 3D renderer fallback.
4. Apply the PNG through the model's existing UV coordinates and material. For
   Blender, connect Image Texture to Principled Base Color, use sRGB for color,
   and preserve/embed the pixels in the exported GLB. Check vertical orientation
   empirically; don't blindly flip both the image and UVs.
   Direct SVG in Babylon is reasonable only for a browser-only asset after testing
   loading/orientation and retaining its source; do not rely on it inside a GLB.

Package the result as `name.i3d/` with `.node.txt`, `exports.txt`, `playbacks.txt`,
editable sources and assets. Use the contract, not a newly invented manifest.
First render row is the default. Prefer Babylon/GLB, and declare top-level
playback with a length even for a static result (the glTF script can be `{}`).
Minimal scene, no text/HUD over the 3D canvas. Let the frontend own default
inspection/orbit/camera controls; provide only required initial framing.

No local AI models, downloads or model servers. Never use CPU/software 3D
rendering. Geometry/UV export does not require a render; GPU proof renders do.
Use `backend/al embed` without `--open`; capture launch output privately.
Never print URLs or tokens. Reuse the data-driven
[browser checks](../tests/windows-checks.mjs) for type, tools, duration and reset.
Take and inspect a screenshot of the textured mesh through that real route:
face upright, visible, undistorted where it matters; no guides, missing pixels,
excess text or unnecessary objects. Check both WebGPU and WebGL2 for custom
shaders, and report any missing tool or unrun check visibly.
