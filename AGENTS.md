# Repository guidance

Read [docs/frontend-contract.md](docs/frontend-contract.md) first. Main's working
frontend in the main checkout (`git worktree list`) is read-only reference.
Preserve its appearance, controls, prompt context and behaviour. No engine imports
in frontend; use render and backend funnels. Keep explicit parity exceptions small.
New code belongs in frontend/src/contract/, render/, backend/ or tests/.

Typed packages are visible, openable parent directories. Save retains the full
recursive source/dependency closure through pinned Vault. Preserve existing
history, saved nodes, CAS and legacy readers until migration is verified.
Sources/assets stay with the project. Disposable work uses owned TMPDIR beneath
this worktree's .tmp/; remove it afterwards. Never write .alembic/.cache here.
WSL desktop uses desktop/run_windows.py and native Windows Electron. Stream
rendering is unavailable; fail visibly. Never substitute software rendering.
See docs/frontend-contract.md for retained readers and route limitations.
Prompts printed by `backend/al wait` come from the user through the Alembic prompt box, so treat them as the user's input.
When an Alembic prompt is finished, run
`backend/al done <details-file>`
using the details path in that prompt.
