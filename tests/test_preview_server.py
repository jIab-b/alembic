"""Preview origin isolation and lifecycle, without a project or live Vault."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, ProxyHandler, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview_server import ensure_preview, preview_http_server, ROUTES


class PreviewServer(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.assets = self.root / 'assets'
        self.assets.mkdir()
        for path in ROUTES:
            file = self.assets / path.removeprefix('/assets/')
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('packaged ' + file.name)
        (self.assets / 'private.txt').write_text('must not be served')
        self.http = build_opener(ProxyHandler({}))

    def test_only_packaged_routes_and_declared_parent_are_allowed(self):
        server = preview_http_server(self.assets, 'http://127.0.0.1:54629')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f'http://127.0.0.1:{server.server_port}'
            for path in ROUTES:
                with self.http.open(origin + path) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn("frame-ancestors 'self' http://127.0.0.1:54629", response.headers['Content-Security-Policy'])
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
                    self.assertIsNone(response.headers.get('Set-Cookie'))
                    self.assertTrue(response.read().startswith(b'packaged '))
            for path in ['/', '/vms', '/w/workspace/file', '/assets/private.txt', '/assets/play/app/session/index.html', '/assets/play/../private.txt']:
                with self.assertRaises(HTTPError) as error:
                    self.http.open(origin + path)
                self.assertEqual(error.exception.code, 404)
                error.exception.close()
            with self.assertRaises(HTTPError) as error:
                self.http.open(Request(origin + '/assets/play/index.html', headers={'Host': 'attacker.example'}))
            self.assertEqual(error.exception.code, 403)
            error.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_origins_are_reused_per_project_and_stop_with_controller(self):
        controller = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        self.addCleanup(lambda: controller.poll() is None and controller.terminate())
        runtime = self.root / 'runtime'
        try:
            with patch.dict(os.environ, XDG_RUNTIME_DIR=str(runtime)):
                first = ensure_preview('http://127.0.0.1:54629', 'one', self.assets, controller.pid)
                self.assertEqual(first, ensure_preview('http://127.0.0.1:54629', 'one', self.assets, controller.pid))
                second = ensure_preview('http://127.0.0.1:54629', 'two', self.assets, controller.pid)
                self.assertNotEqual(first, second)
                discovery = json.loads((self.assets / 'preview-origin.json').read_text())
                self.assertEqual(discovery, {'controller': 'http://127.0.0.1:54629', 'workspaces': {'one': first, 'two': second}})
            controller.terminate()
            controller.wait(timeout=5)
            deadline = time.monotonic() + 5
            while list((runtime / 'alembic-preview').glob('*.json')) and time.monotonic() < deadline:
                time.sleep(.05)
            self.assertEqual(list((runtime / 'alembic-preview').glob('*.json')), [])
        finally:
            if controller.poll() is None:
                controller.terminate()
            controller.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
