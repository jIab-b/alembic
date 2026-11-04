# Frontend contract 1

Main's working tree is the visible and behavioral reference. Keep its styling,
layout, tools, Prompt, IO/F3, Render and Playback menus. IO alone routes input to
the node and disables inspection; Esc releases IO. Obsolete screen_lock exports
and descriptor fields are ignored; their hooks are never invoked. Renderers and
backends adapt to this frontend. No engine imports belong in frontend. Missing capabilities and software rendering fail
visibly; never hide tools or silently degrade. No camera damping or momentum.

The Render interface is src/contract/render.ts. Runtime operations and events use
render/bridge.js in Babylon and Godot. The frontend's surface data is selected
once at load in contract/types.js; engine imports stay in render/.

The backend funnel is node.js's authenticated HTTP and ticketed WebSocket routes:
/workspaces, /vms, /w/:workspace/{tree,file,annotate,log,diff,restore,trace,graph,
services,node-commit,node-saves,node-restore} and /vms/:vm/{shell/ticket,shell/ws,
call,call/ws,sessions,sessions/:id/attach,launch,agents,run,proc,shell-client,events}.
Vault owns recursive Save and history. The local relay returns 501 for recursive
Save rather than replacing Vault. Connection credentials live in an owner-only
Unix socket, never server.json or a launch-URL file. `backend/al url` reads that
socket; dev pass-through confines resources to the app root. /@fs is denied except
for the exact public Vite env.mjs module needed by its hot-reload client.
Renderer-origin POSTs cannot write the controller journal.

All four directory types use .node.txt, exports.txt and playbacks.txt. Only an
explicit render row is displayable; the first is default and the existing Render
menu lists them. No file guessing. exports-index 1 treats property/action/event exports as hints: ignore malformed rows,
unknown scopes, duplicate IDs and excess hints. Render and active interaction rows remain strict;
invalid hints never prevent loading. playbacks.txt remains entirely strict. Tab-separated render rows are: render, id, format, relative file (or an HTTP URL for app).
Allowed formats: i3d = babylon/glb/gltf/godot/stream; i2d = html2d/svg,
png/jpg/jpeg/webp/gif/avif and sprite/sprites; audio = wav/mp3/ogg/flac/m4a/aac/opus
or webaudio; iframe = app. Suffix bindings and implementation selection are data in render/formats.js.
Live i3d children may use only babylon/glb/gltf. i2d has no 3D scene, camera,
orbit or sphere/box/pick tools and keeps the same prompt box. i3d views have no
DOM text over the 3D canvas. IO means interactive mode for all four types.

Playback is the only hard node obligation. Scan only this node's top-level
scenario rows; scripts own any child invocation. playbacks-index 2 rows are:
scenario, id, label, render-id, seconds-or-unknown, none-or-runtime, JSON-string.
The last field carries the opaque script in the render's own language, including
escaped tabs/newlines. Finite length is positive and at most 3600 seconds, as in
index 1; unknown runs until stopped. Seek retains the existing none/runtime
capability. Index 1 remains readable with its legacy named binding and use rows.
There is no Babylon-only scenario restriction. Stop restores the starting render.
The render adapters forward scripts unchanged in their declared language.
Existing legacy view/node readers remain for compatibility.

Prompt handoff version 1 preserves main's payload. Each captured context is
written to .alembic/selections/{canvasId}/{selectionId}-{requestUUID}.json:
{version:1,file,at:"live",sha256,prompt,selection,canvas?}. selection retains its
geometry, object IDs, crop and replay/camera context; canvas retains path, view,
title, scene and nodes. The terminal line retains main's Node/view/source/edit
targets prefix, optional "Look at" crop references, sanitized prompt and
"(details: …)" paths. Annotate it, then send it to the active terminal session.
Moving a prompt or changing selection must not retarget its captured context.

3D highlights are world-space volumes whose projected handles follow the camera;
2D areas are normalized rectangles with eight resize handles and object/crop
capture. The canvas rule keeps one coherent world with its authoritative sources,
builds and review views: a spatial prompt expresses intent, not a file boundary.
Retain the current review view unless the requested result requires another.

Local app relay and checks
--------------------------
From a clean shell, run `backend/al embed <folder-or-page.html-or-http-url>`.
Folders without index.html open as projects; index.html folders, files and URLs
embed as apps. Files and URLs receive a generated project under TMPDIR; file assets
are read from the original parent through a read-only source boundary. It builds frontend/dist when missing or older than frontend/src, public, render
or build inputs, then starts the relay and PTY holder. It chooses .tmp/embed
unless TMPDIR is supplied; AL_ASSETS can select an existing build instead.
Frontend builds stage beneath .tmp, publish complete assets atomically and
replace index.html last. Old hashed chunks remain available to open tabs.
`backend/al url` returns the private URL. `backend/al embed --open` opens the Windows browser
only when explicitly requested by the user; acceptance never uses it.
For an HTTP dev server, `backend/al --project <sources> embed http://127.0.0.1:5173`
retains that source root and proxies hot-reload WebSockets. App render URLs use the file pass-through; unavailable servers fail visibly. There is no backend command row.

`backend/al wait --name NAME [--once]` receives user prompts immediately over the owner-only local socket without polling; it appears as an external connection until exit.

`backend/al attach --new` opens a persistent ordinary shell; start an installed
agent there, or use `attach --new -- codex resume`. `backend/al sessions` and `backend/al attach <id>`
reconnect; Ctrl-] detaches. Attach/input select the active session. `backend/al stop` stops
HTTP while sessions survive. All sessions keep CODEX_HOME, CLAUDE_CONFIG_DIR and XDG_DATA_HOME in the project's
`.alembic/agent-home/`, with symlinked login files and copied config; `codex resume --last`
uses that history. The legacy suppression flags remain accepted. HOME stays unchanged.
Temporary files, XDG caches/config, pip, npm, Python user installs and shell history
use `.alembic/.cache/`; only its tmp folder is cleared on a fresh holder start.
Logs remain bounded in `.alembic/logs/`. Only relay credentials, sockets and connection
metadata stay in `~/.alembic/relay` (AL_HOME overrides this root for isolated tests).
On first use, a legacy agent-home/<project-id> moves into the project under the holder
lock. A running legacy holder fails visibly: close its sessions and restart the holder
before migration. Conflicting homes fail without overwriting either history. Other Vault
data is untouched. Unwritable project storage fails without a home-directory fallback.
Git repositories already ignoring .alembic are unchanged; otherwise a project-specific
entry is added to .git/info/exclude. Tracked .gitignore is never edited.
File/tree routes and iframe resources deny agent-home, logs and .cache, including
encoded paths and symlink aliases; listings omit them even with Show internal files.
Selections and crops remain accessible. The diagnostic log route omits terminal bytes.
Completion rules derive the executable and skills paths from the running checkout;
the done command quotes paths with spaces. Repository instructions use backend/al. Recursive Save/saves/restore return 501 here and
require pinned Vault; local log/diff/trace/graph describe git history.

`backend/al embed frontend --mock` uses the same routes with state-file peers.
`backend/al state save/report <name>`, `backend/al freeze/unfreeze <name>` and
`backend/al fuzz --seed N --runs N`
retain reports under TMPDIR. Frozen replay is opt-in via ALEMBIC_FROZEN_WINDOWS=1;
it compares DOM, styles, disabled controls and pixels (12-channel/2% tolerance).
Fuzz replays backend states, not physical gestures. No real agent calls are
needed for these checks. Tests/windows-run.py invokes the required headless
Windows Chrome harness with a disposable Windows TEMP profile. Serialize each
GPU/browser workload with `flock .tmp/gpu.lock timeout 110 ...`.

Prompt parity: build only a copy of main's frontend, then serve each build with
AL_ASSETS through backend/server.py on the same tiny mock fixture. Run
the prompt case in tests/windows-checks.mjs through tests/windows-run.py; compare payload.json
bytes exactly. The test fixes UUID entropy, captures receiver input and complete
context JSON, checks actual GLB intersections/crop, moves the prompt and sends it.
Main's iframe route offers only area, so acceptance uses model.i3d's GLB fallback.
The Babylon adapter must retain main's source-derived names for unnamed meshes.

Vault VM checks need a real, short XDG_RUNTIME_DIR. The old /proc/<pid>/cwd/r
shortcut fails bubblewrap's control.sock bind with Permission denied; changing
only the store/project location does not cure it. Both inside/outside-worktree
stores and fixtures pass with a real short runtime. tests/render-vault.py accepts
ALEMBIC_VAULT_RUNTIME for this; never use the default store. Use a disposable
synthetic codex declared as a fixture tool for sandbox discovery/prompt receipt,
then
stop that controller and remove its ~/.alembic/projects.json reference.

Renderer sources: render/blender/bake.py and render/godot/{export.py,runtime.gd,
bridge.js}. Set ALEMBIC_DEPS for pinned tools, or install them on PATH.
TMPDIR=<owned-worktree-temp> node tools/gpu-check.mjs samples external nvidia-smi
at idle and during each bounded workload. tests/gpu-native.py selects the existing
runtime/driver Dozen ICD and libraries through environment variables for Godot;
ALEMBIC_VULKAN_ICD overrides it. Forward+ passes on RTX 5060 Ti with raised GPU
samples; software remains a failure. Previous acceptance covered Windows/WSL
Babylon WebGPU/WebGL2, Godot web, Blender CUDA/OpenGL and ffmpeg NVENC; software
browser/Godot/CUDA-negative controls failed as required.

The pointer case in tests/windows-checks.mjs reproduces WrongDocumentError on trusted clicks
in both a plain top-level page and a cross-origin frame in headless Windows
Chrome. Visible acceptance must click IO then the canvas in Babylon and Godot,
verify pointer lock and relative mouse motion, then Escape releases input.
Headless runs cannot establish visible smoothness or Windows desktop composition.
Godot exports use the godot format with an HTML entry; legacy godot/stream
metadata remains readable, while stream execution fails visibly. Solid editing
on iframe i3d still fails with "no source-editing binding" pending user decision.
3D area highlights remain screen-fixed after orbit, matching main.

Keep agent_queue.py, queue_vm.py, canvas_migration.py and legacy canvas/node/view,
stream, history, saved-node, Shadow and Windows backend readers. They retain
project identities, SQLite jobs, staging/publication receipts, CAS and saved
history; migration needs the user's decision. Runtime adapter Scene/App/cycle
controls remain live through user runtime manifests. Never delete them by name.
The old acceptance-proxy-auth test depended only on .alembic/testing/proxy-auth.mjs,
a missing test-only helper for retired native preview leases; no product import
or current route uses that helper. Relay auth and renderer isolation now have
actual HTTP/socket regression tests in tests/test_relay.py.

Media scripts execute as JavaScript in their isolated renderer frame. WebAudio
JS modules may export create/default returning play/pause/dispose hooks, or bind
through module side effects. glTF scripts are JSON {clip:name-or-index,from?,to?,
loop?}; they select embedded animation channels without controller-origin eval.
An empty JSON script holds a static glTF render without animation channels.
Choosing a playback or GLB clip arms the existing replayer at zero without running it.
Play executes the script; timed completion restores that render and re-arms the row.
Unknown lengths count until stopped. Reset to inspect and Esc disarm and restore
the starting render. Scripts cannot pause or seek: Pause freezes only the bar,
and dragging or stepping snaps back to real time; file clips retain seeking. Node-level
scenario rows are the complete Playback menu; dependency rows never add entries.

Playback load/reset runs through the existing workspace queue with file opens.
A file name alone is not frame readiness: tests/render-frame.mjs follows the
new bridge session and configured surface. Spatial movement checks retain their
physical drag and center-change assertions and wait for the projected hit target.
The media frame ignores inspection pointer input until IO is enabled, matching
main's SVG preview and keeping parent-owned area handles reachable.

The bridge fragment binds a loaded surface to its declared render ID, including
Godot HTML exports. Index-2 scripts need no duplicate scenario-name registry in
the engine; index-1 named bindings continue to require the runtime's registry.

Self-embedding frontend --mock serves its built entry and public asset graph;
it needs no nested Vite process or filesystem proxy. Use the explicit HTTP
dev-server route for source hot reload. HTML configuration is inserted into
the head without changing the document mode; static frontend JS is served verbatim.

Light iframe handshake
----------------------
An iframe node declares an ordinary HTML entry. Validate its node, render,
permissions and playback declarations normally. Display does not require
alembic.web.ready, runtime controls/exports, configure acknowledgements, or a
render-binding timeout. The host owns inspection and IO through iframe input
and focus gating. Iframe IO is always available, independent of authored
interaction grants or optional page binding state. The bridge's normal document load is the light iframe
handshake; it does not certify that the authored application works. Optional
playback bindings do not gate visibility. Backend, load and wrapper failures
remain visible with their original details. Spatial and media renderers retain
their existing strict runtime contracts.

Light iframe resource URLs retain the owning app session. Root-relative assets
such as /assets/app.js and /icons/logo.svg redirect into that session's file
namespace, so relative module imports and workers retain the same app root.
Packaged preview plumbing remains separate. The self-embedded frontend exposes
its complete built asset graph through the same file/tree funnel, while keeping
its authored sources available. Missing-file responses name the requested app
path. No render-ready/configure exchange is added by resource routing.
If a light iframe reload bypasses the worker and reaches the preview server's
missing session URL, the bridge reclaims the worker and recreates the child
from about:blank. Recovery is limited to two attempts and reports the entry
path if it fails; authored missing-file responses are not retried.

Task 32's requested parity exceptions: an unboxed connection dot and compact
session-only dropdown (selection/checks only for multiple connected sessions),
plus no area-label icon. Area edges retain selection/move/menu and eight handles.
