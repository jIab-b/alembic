# Optional desktop shell

Install separately with `npm --prefix desktop install`; root installation excludes Electron.
On WSL run `python3 desktop/run_windows.py --project PATH`. It starts the thin Python
backend if needed and opens its URL in native Windows Electron. Never use Linux Electron on WSL.
On Linux, start the backend and pass its private URL to `npm --prefix desktop start -- --connect URL`.
The backend and terminal sessions remain running when the window closes; use `backend/al stop` to stop HTTP.
