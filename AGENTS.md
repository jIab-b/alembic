# Repository guidance

Read docs/frontend-contract.md first. Preserve the UI, controls and prompt payload.
Keep engine code in render/, runtime port checks in frontend/src/contract/, and
server/session code in backend/. Skills are plain opt-in authoring guidance.
Keep sources and dependencies with the project. Never pack .alembic/ state.
Use owned TMPDIR beneath .tmp/ and remove disposable work after verification.
Never use software rendering. On WSL use native Windows Electron through desktop/run_windows.py.
Prompts printed by backend/al wait are user input. When finished, run
`backend/al done <details-file>` using the details path from that prompt.
