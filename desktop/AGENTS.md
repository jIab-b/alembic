WSL desktop uses the native Windows executable via run_windows.py. Never substitute
Linux Electron. Keep the shared web frontend and pinned Vault operations. The
native rendering surface bridge is retired; legacy Windows Vault/history readers
remain pending migration. Automated checks must stay headless with disposable
profiles; they cannot establish visible Windows composition or smoothness.
