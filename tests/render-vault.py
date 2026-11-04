"""Disposable pinned Vault and preview; all writes remain beneath caller TMPDIR."""
import argparse, os, signal, socket, sys, threading
from pathlib import Path
sys.dont_write_bytecode = True
repo = Path(__file__).resolve().parents[1]
root = Path(os.environ['TMPDIR']).resolve()
args=argparse.ArgumentParser(description=__doc__);args.add_argument('--files-only',action='store_true',help='Exercise Vault files with terminal acceptance explicitly unavailable');args=args.parse_args()
release = Path.home()/'.local/share/vpsctl/releases'/(repo/'vault.lock').read_text().strip()
sys.path.insert(0, str(release)); sys.path.insert(0, str(repo))
import vpsctl as vc
from preview_server import preview_http_server
with socket.socket() as s:
    s.bind(('127.0.0.1', 0)); port=s.getsockname()[1]
runtime=Path(os.environ.get('ALEMBIC_VAULT_RUNTIME',root/'r')).resolve()
runtime.mkdir(parents=True,exist_ok=True)
os.environ.update(SW_STORE=str(root/'store'), XDG_RUNTIME_DIR=str(runtime), VPSCTL_DEV='1', SW_HTTP_PORT=str(port), SW_CONSOLE_DIR=str(root/'dist'), SW_IDLE_EXIT='3600', RELEASE_DISTRIBUTION='none')
os.chdir(root)
vc.pin_release(repo/'vault.lock')
vm=server=None
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
try:
    workspace=vc.workspace(str(root/'fixture'))
    if not args.files_only: vm=vc.vm(wspc=workspace,isolation='light',limits={'cpu':2,'memory_mb':1024,'pids':128})
    origin=f'http://127.0.0.1:{port}'
    server=preview_http_server(root/'dist/assets',origin)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    from urllib.parse import urlencode
    url=origin+'/#'+urlencode(dict(node=origin,token=(root/'store/token').read_text().strip(),workspace=workspace.id,vm=vm.id if vm else 'render-check-stopped',preview=f'http://localhost:{server.server_port}'))
    (root/'url').write_text(url)
    print('Disposable Vault ready'+(' (files only; no terminal VM)' if args.files_only else ''),flush=True)
    threading.Event().wait()
finally:
    if server: server.shutdown()
    if vm: vm.stop()
    vc.stop_vault(force=True)
