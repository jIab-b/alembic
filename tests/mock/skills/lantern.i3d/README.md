# Lantern

Open `lantern.i3d` as a node. Choose **Slow lantern flicker** in Playback,
then press Play for the 16-second animation. Reset returns to the lit still.
Use the host's orbit, pan, and zoom controls to inspect it.

The scene is procedural, with no external textures. `scene.js` owns the geometry
and playback; `shaders.js` contains matching GLSL and WGSL shaders. The flame,
its amber halo, and the pool of light share a slow, layered flicker signal.
`runtime.source.js` lists the node-local additions from pinned Babylon 9.33.1;
`runtime.min.js` and `chunks/` retain their bundled browser runtime. The shared
engine, scene, camera, box primitive, and renderer binding come from the host.

To rebuild the local runtime, set `ALEMBIC_ROOT` to the host repository and run
`node build-runtime.mjs` with its existing pinned dependencies.

Validated on hardware Windows WebGPU and WSL WebGL2. All nine materials compile
on both paths. Playback and reset work. Windows reset pixels match exactly; the
WSL strict reset comparison differs at 13 pixels by at most 2/255 per channel.
Details are retained in `validation.json`.
