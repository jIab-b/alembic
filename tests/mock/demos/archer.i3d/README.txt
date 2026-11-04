WOODLAND GUARD — archer.i3d

Open the archer.i3d directory in Alembic. The default Babylon render is an
articulated, rounded toy soldier with pine-green armour, brass trim, an ash
recurve bow, a stocked leather quiver and a freestanding archery target.
All geometry is authored locally; there are no studs or external model assets.

Choose a scenario from Playback, then press Play:
  Idle · on watch              6 seconds: breathing and a gentle lookout.
  Walk cycle · patrol       6.3 seconds: six 1.05-second cycles in place,
                             alternating hips and knees, body bob and bow sway.
  Draw, release & hit target   9 seconds: raise the bow, pull the string,
                             hold full draw for 2.4 s, lean back, release at 5 s,
                             a fiery flight, a large fire-and-ember burst at
                             5.65 s, target recoil, then lower the bow.

The arrow remains embedded until playback completes. Completion or Reset to
inspect restores the exact starting pose, arrow visibility and camera.
The scripts use the renderer's JSON animation commands declared in playbacks.txt;
scene.js contains the articulated model and deterministic pose functions.
Runtime scripts follow the host contract: their seek mode is none.

Inspection orbit, pan, zoom and selection belong to Alembic's shared binding.
The renderer uses native WebGPU when available, otherwise hardware WebGL2.
Software rendering is rejected visibly by the shared binding.

source/runtime.source.js declares the small set of node-local Babylon additions.
To rebuild with the host's pinned dependencies:
  ALEMBIC_ROOT=/path/to/al_web node source/build-runtime.mjs
All bundled runtime chunks stay in assets/; the host provides renderer.js.
