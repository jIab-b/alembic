"""Release selection and real launcher acceptance; temporary projects and credentials."""
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tempfile
TEMP = Path(os.environ.get('TMPDIR', Path(__file__).resolve().parents[1] / '.tmp'))
TEMP.mkdir(exist_ok=True, parents=True)
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import launcher
from vpsctl import sandbox as s


class AgentHandoff(unittest.TestCase):
    def test_project_refs_update_without_moving_legacy_data(self):
        import json
        with tempfile.TemporaryDirectory(dir=TEMP) as root, patch.dict(os.environ, HOME=root):
            legacy = Path(root) / '.alembic/projects/old/data'
            legacy.parent.mkdir(parents=True)
            legacy.write_text('retained')
            launcher.remember_project('one', Path('/first'), 'a' * 40)
            launcher.remember_project('two', Path('/second'), 'b' * 40)
            launcher.remember_project('one', Path('/moved'), 'c' * 40)
            refs = json.loads((Path(root) / '.alembic/projects.json').read_text())
            self.assertEqual(refs['one'], dict(path='/moved', vault_release='c' * 40))
            self.assertEqual(refs['two']['path'], '/second')
            self.assertEqual(legacy.read_text(), 'retained')
            self.assertEqual({p.name for p in (Path(root) / '.alembic').iterdir()}, {'projects', 'projects.json'})

    def test_launcher_passes_the_vm_discovery_list_including_custom_agents(self):
        names = ['claude', 'codex', 'opencode', 'custom-agent']
        with tempfile.TemporaryDirectory(dir=TEMP) as root:
            root = Path(root)
            (root / 'token').write_text('synthetic-token')
            with patch.object(launcher.vc, 'pin_release', return_value='a' * 40), patch.object(launcher.vc, 'vm') as open_vm, \
                    patch.object(launcher, 'existing_vault', return_value=None), \
                    patch.object(launcher.socket, 'socket') as socket, patch.object(launcher.signal, 'signal'), \
                    patch.object(launcher.threading, 'Event'), patch.object(s, '_store', return_value=root), \
                    patch.object(launcher, 'project_preview', return_value='http://127.0.0.1:2345'), patch.object(launcher, 'open_browser') as browser, patch.dict(os.environ, HOME=str(root)):
                vm = open_vm.return_value.__enter__.return_value
                vm.id, vm.workspace.id = 'live', 'project'
                vm.shell_command.return_value = '/synthetic/shell'
                vm.agents.return_value = names
                socket.return_value.__enter__.return_value.getsockname.return_value = ('127.0.0.1', 1234)
                launcher.main([str(root), '--open-browser', '--port', '1234'])
                socket.return_value.__enter__.return_value.bind.assert_called_once_with(('127.0.0.1', 1234))
                vm.agents.assert_called_once_with()
                vm.shell_command.assert_called_once_with()
                vm.ssh.assert_not_called()
                config = parse_qs(urlsplit(browser.call_args.args[0]).fragment)
                self.assertEqual(config['agents'], [','.join(names)])
                self.assertEqual(config['node'], ['http://127.0.0.1:1234'])
                self.assertEqual(config['preview'], ['http://127.0.0.1:2345'])
                browser.reset_mock()
                with patch('builtins.print') as printed:
                    launcher.main([str(root), '--port', '1234'])
                browser.assert_not_called()
                urls = [call.args[0] for call in printed.call_args_list if call.args and str(call.args[0]).startswith('http://')]
                self.assertEqual(len(urls), 1)
                self.assertEqual(parse_qs(urlsplit(urls[0]).fragment)['workspace'], ['project'])

    def test_project_stop_uses_vm_stop_and_never_stops_another_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.alembic').mkdir()
            (root / '.alembic/project.json').write_text('{"id":"ours"}')
            running = ({'vault': '0.1.0+' + launcher.PIN}, [
                {'id': 'ours-vm', 'workspace': 'ours'}, {'id': 'other-vm', 'workspace': 'other'}])
            with patch.object(launcher, 'existing_vault', return_value=running), patch.object(launcher, 'reuse_release'), \
                    patch.object(launcher.vc.VM, 'from_id') as attach, patch.object(launcher.vc, 'pin_release') as pin, \
                    patch.object(launcher.vc, 'vm') as create, patch('builtins.print'):
                launcher.main([str(root), '--stop'])
                attach.assert_called_once_with('ours-vm')
                attach.return_value.stop.assert_called_once_with()
                pin.assert_not_called()
                create.assert_not_called()

    def test_status_and_stopping_an_absent_vm_do_not_boot_a_controller(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(launcher, 'existing_vault', return_value=None), \
                patch.object(launcher.vc, 'pin_release') as pin, patch.object(launcher.vc, 'vm') as create, patch('builtins.print'):
            launcher.main([directory, '--stop'])
            launcher.main([directory, '--status'])
            pin.assert_not_called()
            create.assert_not_called()

    def test_start_reuses_same_controller_origin_without_selecting_a_new_ui(self):
        with tempfile.TemporaryDirectory(dir=TEMP) as directory:
            root = Path(directory)
            (root / 'token').write_text('synthetic-token')
            running = ({'vault': '0.1.0+' + launcher.PIN}, [])
            with patch.object(launcher, 'existing_vault', return_value=running), patch.object(launcher, 'reuse_release') as reuse, \
                    patch.object(launcher, 'controller_port', return_value=54629), patch.object(launcher.vc, 'pin_release') as pin, \
                    patch.object(launcher.vc, 'vm') as create, patch.object(launcher, 'remember_project'), \
                    patch.object(launcher.signal, 'signal'), patch.object(launcher.threading, 'Event'), \
                    patch.object(s, '_store', return_value=root), patch.object(launcher, 'project_preview', return_value='http://127.0.0.1:2345'), patch.object(launcher, 'open_browser') as browser, patch('builtins.print') as printed:
                vm = create.return_value.__enter__.return_value
                vm.workspace.id, vm.id = 'project', 'fresh-vm'
                vm.shell_command.return_value = '/synthetic/shell'
                vm.agents.return_value = []
                launcher.main([directory])
                reuse.assert_called_once_with()
                pin.assert_not_called()
                browser.assert_not_called()
                url = next(call.args[0] for call in printed.call_args_list if str(call.args[0]).startswith('http://'))
                self.assertTrue(url.startswith('http://127.0.0.1:54629/#'))
                self.assertEqual(parse_qs(urlsplit(url).fragment)['vm'], ['fresh-vm'])


class PinSelection(unittest.TestCase):
    def test_launcher_imports_the_pinned_python_even_with_a_live_override(self):
        result = subprocess.run([sys.executable, '-c', 'import launcher; print(launcher.vc.__file__)'],
                                cwd=launcher.BASE, capture_output=True, text=True, check=True,
                                env={**os.environ, 'VPSCTL_HOME': '/unrelated/live-checkout'})
        self.assertEqual(Path(result.stdout.strip()).resolve(), (launcher.RELEASE / 'vpsctl/__init__.py').resolve())

    def test_exact_provisioned_pin_and_idempotent_path(self):
        self.addCleanup(setattr, s, '_fresh_release', s._fresh_release)
        with tempfile.TemporaryDirectory(dir=TEMP) as root, patch.dict(os.environ, {
            'HOME': root, 'PATH': '/usr/bin:/bin', 'XDG_RUNTIME_DIR': root,
            'VPSCTL_NODE_SOCKET': root + '/absent.sock', 'SW_STORE': root + '/store',
        }, clear=True):
            lock = Path(root) / 'vault.lock'
            lock.write_text('main\n')
            with self.assertRaises(ValueError):
                launcher.vc.pin_release(lock)
            pin = 'a' * 40
            lock.write_text(pin + '\n')
            with self.assertRaisesRegex(s.NodeError, 'missing_release'):
                launcher.vc.pin_release(lock)
            release = Path(root) / '.local/share/vpsctl/releases' / pin
            release.mkdir(parents=True)
            (release / 'sha').write_text('b' * 40)
            with self.assertRaisesRegex(s.NodeError, 'release_mismatch'):
                launcher.vc.pin_release(lock)
            (release / 'sha').write_text(pin + '\n')
            for _ in range(2):
                self.assertEqual(launcher.vc.pin_release(lock), pin)
            self.assertEqual(os.environ['PATH'].split(os.pathsep).count(str(release / 'bin')), 1)
            for key, binary in [('VPSCTL_NODE', 'sandbox_worker'), ('SW_ISOLATOR', 'isolator'), ('SW_STATECTL', 'statectl')]:
                self.assertEqual(os.environ[key], str(release / 'bin' / binary))
            self.assertEqual(os.environ['VPSCTL_RELEASE'], pin)


class LauncherAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from extern.sandbox_worker.test.provenance_support import prerequisites
        reason = prerequisites()
        if reason:
            raise unittest.SkipTest(reason)
        cls.release = Path.home() / '.local/share/vpsctl/releases' / (launcher.BASE / 'vault.lock').read_text().strip()
        if not (cls.release / 'bin/sandbox_worker').is_file():
            raise unittest.SkipTest('vault.lock release is not provisioned')
        if not (launcher.BASE / 'frontend/dist/index.html').is_file():
            raise unittest.SkipTest('frontend build is unavailable')

    def test_core_loop_and_shutdown_signals(self):
        for stop_signal in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=stop_signal), tempfile.TemporaryDirectory(dir=TEMP, prefix='alembic-launch-') as root:
                root = Path(root)
                project = root / 'project'
                project.mkdir()
                release = root / 'home/.local/share/vpsctl/releases' / self.release.name
                release.parent.mkdir(parents=True)
                release.symlink_to(self.release, target_is_directory=True)
                runtime = root / 'runtime'
                runtime.mkdir()
                env = dict(HOME=str(root / 'home'), PATH=os.environ['PATH'],
                           VPSCTL_HOME=str(Path(s.__file__).resolve().parents[1]),
                           XDG_RUNTIME_DIR=str(runtime), SW_STORE=str(root / 'store'),
                           ERL_FLAGS='+S 4:4', BROWSER='/bin/true', PYTHONDONTWRITEBYTECODE='1',
                           GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1')
                with (root / 'launch.log').open('w+') as log:
                    process = subprocess.Popen([str(launcher.BASE / 'launch.sh'), '--vault', str(project)], env=env,
                                               stdout=log, stderr=log)
                    identity = None
                    try:
                        deadline = time.monotonic() + 30
                        url = None
                        while time.monotonic() < deadline:
                            log.seek(0)
                            lines = log.read().splitlines()
                            url = next((line for line in lines if line.startswith('http://')), None)
                            if url or process.poll() is not None:
                                break
                            time.sleep(.05)
                        self.assertIsNotNone(url, '\n'.join(lines))
                        config = {key: value[0] for key, value in parse_qs(urlsplit(url).fragment).items()}
                        self.assertEqual(config['node'], url.split('/#')[0])
                        self.assertEqual(config['token'], (root / 'store/token').read_text().strip())
                        with patch.dict(os.environ, env, clear=True):
                            identity = s._request('GET', '/version')
                            vm = launcher.vc.VM.from_id(config['vm'])
                            opened = s._request('GET', '/vms')
                            self.assertEqual(len(opened), 1)
                            self.assertEqual(opened[0]['isolation'], 'bwrap')
                            workspace = launcher.vc.workspace(project)
                            self.assertEqual(workspace.id, config['workspace'])
                            result = vm.run(['sh', '-ec', 'printf core-check > check.txt'])
                            self.assertEqual(result.exit, 0)
                            self.assertTrue(result.commit)
                            ssh = subprocess.run(shlex.split(vm.ssh()) + ['cat /workspace/check.txt'],
                                                 env=env, capture_output=True, timeout=15)
                            self.assertEqual((ssh.returncode, ssh.stdout), (0, b'core-check'))
                            source = "import os,shlex,subprocess; subprocess.run(shlex.split(os.environ['VPS_SHELL'])+['test -f /workspace/check.txt'],check=True)"
                            call = vm.call([sys.executable, '-c', source], env=env)
                            try:
                                self.assertEqual(call.wait(timeout=20), 0)
                            finally:
                                if call.returncode is None:
                                    call.cancel()
                            self.assertEqual(vm.run(['sh', '-ec', 'printf changed > check.txt']).exit, 0)
                            workspace.restore(result.commit, paths=['check.txt'])
                            self.assertEqual(workspace.file('check.txt'), b'core-check')
                            self.assertTrue(workspace.log())
                            process.send_signal(stop_signal)
                            self.assertEqual(process.wait(timeout=15), 0)
                            self.assertFalse(any(row['id'] == vm.id for row in s._request('GET', '/vms')))
                    finally:
                        if process.poll() is None:
                            process.terminate()
                            process.wait(timeout=15)
                        if identity:
                            # Only the node started for this temporary store is ours.
                            self.assertEqual(identity['store'], str(root / 'store'))
                            pid = int(identity['pid'])
                            try:
                                os.kill(pid, signal.SIGTERM)
                            except ProcessLookupError:
                                pass
                            deadline = time.monotonic() + 15
                            while time.monotonic() < deadline:
                                try:
                                    state = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()[0]
                                except FileNotFoundError:
                                    break
                                if state == 'Z':
                                    break
                                time.sleep(.05)
                            else:
                                self.fail('temporary vault did not stop')


if __name__ == '__main__':
    unittest.main()
