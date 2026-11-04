# 2D nodes

Read [the contract](../docs/frontend-contract.md) and relevant
[2D examples](../tests/mock/i2d/), resolving links from this skill's directory.

Create an openable `name.i2d/` directory with `.node.txt`, `exports.txt`,
`playbacks.txt`, editable sources and local assets. Follow the referenced formats.
The first explicit render row is the default; do not depend on file guessing.

This is strictly 2D: no 3D scene, camera, orbit, sphere/box/pick tools or engine.
Prefer SVG, then HTML when layout/interaction needs it, then sprites for raster art.
Use few elements, little text and a clear hierarchy. Text belongs only where it
is the content (for example, menu choices); keep labels short. Avoid explanatory
paragraphs, decorative badges, instructions and duplicate on-canvas controls.
Use the frontend's existing prompt, IO and playback controls.
HTML needs the existing render/playback binding shown in the HTML examples;
a standalone HTML page without that handshake will time out as an i2d render.

Drive motion through top-level playback scripts in `playbacks.txt`, with declared
length. The default view and armed scenario remain still until Play; reset
restores them. Use the media renderer's script context shown in the examples,
not a self-starting CSS/SMIL loop or an invented playback API.
Keep animation subtle enough that the content remains easy to read.

Open the result with `backend/al embed` without `--open`. Capture launch output
privately; never print URLs or tokens. No local AI models, downloads or servers.
Reuse the data-driven [browser checks](../tests/windows-checks.mjs): verify the
2D type, area-only tools, IO, default render, declared duration, Play and reset.
Inspect screenshots both before and during Play: few elements, short labels,
readable hierarchy, no scrolling or disappearing content. Check console/status. Report
checks you could not run; never substitute software rendering for a missing GPU.
