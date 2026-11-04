# Frontend contract

Preserve the visible UI, controls, prompt context and behaviour. IO/F3 routes input
to the node and disables inspection; Esc releases it. No camera damping. Missing
capabilities and software rendering fail visibly. No engine imports in frontend.

`frontend/src/contract/{i3d,i2d,audio}.ts` define the three ports. `ports.js` checks
methods at load, including a remote adapter's method declaration. An i3d adapter
has viewport, camera, IO, shapes, pick, objects, capture, playback and events.
An i2d adapter has viewport, IO, area shapes, capture, playback and events; no 3D
scene or camera. Audio has IO, playback, reset, time and events. i3d forbids visible
DOM text over the canvas. `effect.js` checks these effects in the isolated frame.

`render/registry.js` has one row per adapter: formats, port, extensions, loader and
presentation. Optional `entry: [name, path]` builds a stable browser module. Add
an adapter folder and its row, plus a fixture in tests/port-fixtures.mjs, then run
the port conformance suite. No frontend or separate build registration is needed.
Frontend code must not dispatch on engine or format names. Godot is
unsupported for now; stream is not a format. Authoring is loose: export hints and
skills are opt-in, never a build gate. Runtime failures use the existing visible
error surface. Optional property/action/event hints never prevent loading.

Typed nodes are visible directories ending in .i3d, .i2d, .audio or .iframe.
`exports.txt` starts with `exports-index\t1`; render rows contain tab-separated
`render, id, format, relative file`. Only explicit render rows are displayable;
the first is default. A registry row can allow HTTP app URLs. Files and recursive
dependencies stay within the project; imports enter only declared `_deps` aliases.
Existing canvas and node metadata remain readable for supported render types.

`playbacks.txt` is strict. Index 2 rows contain `scenario, id, label, render-id,
seconds-or-unknown, none-or-runtime, JSON-string`. Scripts pass unchanged to the
isolated renderer. Only top-level scenarios enter the Playback menu; scripts own
child invocation. Index 1 remains readable. Choosing arms at zero, Play executes,
completion restores and re-arms. Reset to inspect and Esc disarm. File clips seek;
scripts without seeking snap back to real time. Playback and opens share a queue.

Iframe is a black box: validate declarations and file boundaries, then display
on document load without mandatory readiness/configure or a binding timeout.
Host input/focus gating owns IO. Optional page playback never gates visibility.
Resources retain their owning app session, including root-relative assets.

Prompt handoff v1 is byte-stable. Context goes to
`.alembic/selections/{canvasId}/{selectionId}-{requestUUID}.json` with
`{version:1,file,at:"live",sha256,prompt,selection,canvas?}`. Preserve geometry,
object IDs, crop, replay/camera context and canvas path/view/title/scene/nodes.
Keep the terminal Node/view/source/edit targets prefix, optional Look at crop,
sanitized prompt and `(details: …)` paths. Annotate before sending to the selected
session. Moving/deleting a prompt must not retarget or cancel captured work.
Brewing persists until `backend/al done DETAILS`; deleted UI stays deleted.

The thin standard-library Python backend is the sole route. It exposes authenticated
file/tree/history/session operations and an API-free renderer origin. Credentials
stay in an owner-only socket; `backend/al url` retrieves the private launch URL.
Private agent homes, logs and caches are denied through every file boundary,
including encoded paths and symlink aliases. Recursive saved states return 501.
History uses git. Existing state is never silently discarded or migrated over.

Root `npm install` installs the frontend workspace; `npm start -- PATH` builds when
needed and starts HTTP. `--no-open` suppresses browser launch. `.alembic/` is created
on first use and excluded from packaging. `backend/al attach --new` creates a PTY;
`wait --name NAME` connects an external receiver. Sessions survive page reloads;
launch.sh stops everything this checkout started, on startup and on exit. Agent homes,
logs and caches stay in the project; AL_HOME overrides private connection storage.
Sources, render and public assets invalidate builds. Build staging is atomic, with
index.html published last and existing hashed chunks retained for open tabs.

`npm test` runs CPU suites. Browser acceptance uses `tests/windows-run.py`, headless
Windows Chrome, a disposable Windows TEMP profile, and real GPU checks. Serialize
heavy runs with `flock .tmp/gpu.lock`; check both host memories first. Frozen replay
compares DOM, styles, disabled controls and pixels; do not refresh it for refactors.
Prompt parity compares payload bytes on the same fixture. Browser tests never call
real agents. Optional test_scene is read-only and skips when absent.
