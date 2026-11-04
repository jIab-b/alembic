Run: python3 render/godot/export.py /project/source /project/game.html
TMPDIR is required; set ALEMBIC_DEPS for pinned tools, otherwise tools must be on PATH.
Installs the retained alembic-render.gd autoload in the authored source project.
Uses pinned single-thread WebGL2 templates and loose 8 MiB WASM parts.
Scene hooks: alembic_scenarios() -> IDs; alembic_play(script, id); alembic_reset().
Hooks return null on success or {error: message}; scripts pass through unchanged.
Missing hooks, targeted cameras, solid geometry edits and unknown operations fail.
Canonical godot HTML binding and playback-time forwarding need forbidden frontend changes.
