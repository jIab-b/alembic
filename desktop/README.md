# Desktop shell

The Electron shell shares the web frontend, supports full/minimal layouts and
connects to pinned Vault with optional SSH forwarding of controller and preview
origins. On WSL use `python3 desktop/run_windows.py --project /path/to/project`;
never substitute a Linux GUI. The command attaches to an existing project VM.

Build the shared frontend before packaging with desktop/package.cjs. Native
rendering surface adapters are retired. Windows Vault bootstrap/discovery and its
history-reading controller remain for old projects; do not remove them before
migration. Headless shell checks suppress windows/dialogs, but cannot judge
visible composition or input smoothness. See ../docs/frontend-contract.md.
