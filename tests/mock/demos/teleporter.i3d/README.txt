THE AETHER GATE

Open teleporter.i3d. The default render is an inspection still of the charged
portal. Choose Playback > Awaken the Aether Gate, then press Play.

The 14-second scenario starts dark: crystals wake, 24 runestones ignite around
the arch, and a fast violet spiral opens into a lavender-rimmed portal, shedding
72 short-lived violet-white sparks. The swirl runs at 2.1 radians per second.
Completion and Reset restore the exact charged inspection still. Standard host
orbit, pan, zoom, selection and IO controls remain available. No canvas HUD.

The model has 83 meshes and 14,104 triangles, with a 2048 x 2048 SVG-painted
atlas. Editable sources are in source/:
  teleporter.blend    compressed model with packed textures and authored UVs
  uv-layout.svg      Blender's export of the actual mesh UV layout
  uv-islands.json    padded atlas island bounds in SVG pixel coordinates
  stone-runes.svg    hand-authored vector stone, brass, seals and rune artwork
  rune-emission.svg  matching editable emissive rune mask
  build_model.py     deterministic geometry, UV, art and PNG generation

The six upper-left stones (Runestone_18 through Runestone_23) carry closed-loop
celestial sigils on dark charcoal faces and edges, with matching glow masks.

assets/ contains the baked color and emission PNGs, evaluated geometry, and
node-local additions built from the host's pinned Babylon installation.
shaders.js emits matching native GLSL and WGSL for stone lighting, pulsing UV
runes, crystalline highlights, a logarithmic spiral vortex and aether motes.
scene.js owns the power-up timeline. Inspect mode freezes shader time at zero.

Render > portable is the embedded-texture GLB sculpture. The animated portal
and its power-up are provided by the default main render.

Rebuild with installed Blender:
  blender --background --factory-startup --python-exit-code 1 --python source/build_model.py
Then use the host repository's render/blender/bake.py on source/teleporter.blend
with an owned TMPDIR. That existing wrapper renders a CUDA/OptiX proof and exports
the GLB; there is no software 3D rendering fallback. SVG rasterization uses the
already installed librsvg/Cairo 2D libraries. No downloads are needed.

To rebuild only the node-local runtime, set ALEMBIC_ROOT to the host repository
and run node source/build-runtime.mjs. Keep assets/chunks with runtime.min.js.

Evidence and browser verification results are retained in evidence/.
