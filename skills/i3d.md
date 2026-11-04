# 3D nodes

Read [the contract](../docs/frontend-contract.md) and only relevant
[examples](../tests/mock/i3d/); resolve these links from this file, not the project.

Create an openable `name.i3d/` directory. Keep `.node.txt`, `exports.txt`,
`playbacks.txt`, scene sources and assets together inside it. Use the contract's
actual formats; do not invent a manifest or rely on filename guessing.
Babylon is the default renderer. The first explicit render row is the default.
`exports.txt` property/action/event hints are a loose nudge toward useful controls,
not an exhaustive API or a reason to add UI. Render rows remain strict.
Declare top-level scenarios in `playbacks.txt`, including their length in seconds
(or `unknown` only for unbounded work). Scripts own any child playback invocation.

Use a minimal composition: a few forms, restrained colors and one clear focus.
No text, labels, HUD, DOM overlays or CSS pseudo-element text over the 3D view:
the frontend rejects visible DOM text. Keep explanations outside the renderer.
Do not write orbit handlers or a camera controller for the default view;
the frontend's renderer binding owns inspection, orbit, pan and zoom. Supply only
the camera object/initial framing required by the existing binding; no attachControl.
Read the current renderer binding before using it; its exported primitives are
limited. Use installed pinned Babylon sources if more are needed; no CDN engine.
Reuse shared runtime exports; keep required node-local additions small.
Node-local Babylon additions must share the host's shader stores and required
engine extensions. Await material readiness before binding; test shadows on both GPU paths.
Keep dynamic shader chunks when pruning bundled assets.
No local AI models, downloads or model servers.

Compose children as reusable factories in the parent's scene, with explicit
transforms, update/reset/dispose ownership and project-local dependencies.
Keep each child directory independently openable; do not embed child iframes or
create another engine/camera per child. Live children support babylon/glb/gltf.
Read relevant composition examples under [mock](../tests/mock/) when needed.

## Shaders
Shaders must work on WebGPU (Windows Chrome) and WebGL2 (WSL); check both.
Use compatible Babylon materials or provide both shader languages as needed.
Compile and exercise the actual animated material on each path, not a stand-in.
No software/CPU renderer fallback. Missing GPU support and shader errors must
stay visible; never catch them and silently replace the requested effect.

## Check before finishing
Open the node through the repository's `backend/al embed` route, without `--open`.
Capture launch output privately; never print launch URLs or tokens.
Use real hardware browsers and the data-driven checks in
[windows-checks.mjs](../tests/windows-checks.mjs). Check tools, default render,
scenario length, Play and reset. Take and inspect a screenshot for framing,
minimalism and absence of text; inspect console/status for visible failures.
Report any unavailable GPU path plainly; do not call an unrun check passed.
