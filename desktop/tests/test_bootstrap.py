import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

source = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bootstrap', source/'bootstrap.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

class DesktopBootstrapTest(unittest.TestCase):
    def test_removed_backend_does_not_silently_open_another_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp)/'desktop.txt'
            config.write_text(json.dumps({'schema_version': 1, 'backend_engine': 'go'}))
            with patch.object(b, 'CONFIG', config), patch.object(b.sys, 'argv', ['bootstrap', '--backend', 'linux']), patch.object(b, 'command') as command:
                with self.assertRaisesRegex(RuntimeError, 'pinned Elixir Vault'):
                    b.main()
                command.assert_not_called()

    def test_single_discovered_project_still_requires_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp)/'desktop.txt'
            config.write_text(json.dumps({'schema_version':1,'wsl_distro':'test','linux_install':'/app'}))
            replies = [json.dumps({'protocol_version':1,'capabilities':['discover_projects']}),
                       json.dumps({'projects':[{'id':'x','name':'Example','path':'/project'}]})]
            from unittest.mock import MagicMock
            tk=SimpleNamespace(Tk=MagicMock(),Listbox=MagicMock(),ttk=SimpleNamespace(Label=MagicMock(),Button=MagicMock()))
            with patch.object(b,'CONFIG',config),patch.object(b.sys,'argv',['bootstrap','--backend','linux']), \
                 patch.dict('sys.modules',{'tkinter':tk,'tkinter.ttk':tk.ttk}), \
                 patch.object(b,'command',side_effect=replies) as command,patch.object(b.subprocess,'run') as run:
                b.main()
                self.assertEqual(command.call_count,2)  # Discovery only; no backend inspect/open.
                tk.Tk.return_value.mainloop.assert_called_once()
                tk.Listbox.return_value.selection_set.assert_not_called()
                run.assert_not_called()
    def test_linux_headless_forwarded_and_no_picker(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp)/'desktop.txt'
            config.write_text(json.dumps({'schema_version': 1, 'wsl_distro': 'test', 'linux_install': '/app'}))
            replies = [json.dumps({'protocol_version': 1, 'capabilities': ['discover_projects']}), json.dumps({'projects': [{'id':'x','path':'/project'}]}), json.dumps({'protocol_version': 1, 'capabilities':['open_project']})]
            with patch.object(b, 'CONFIG', config), patch.object(b.sys, 'argv', ['bootstrap', '--backend', 'linux', '--headless-session', '--project', '/project']), patch.object(b, 'command', side_effect=replies), patch.object(b.subprocess, 'run') as run:
                b.main()
                self.assertEqual(run.call_args.args[0][-3:], ['open', '/project', '--headless'])
    def test_stale_owner_requires_identity_change(self):
        record = {'pid': 42, 'process_created': 100}
        self.assertFalse(b.stale_owner(record, lambda _: 100))
        self.assertTrue(b.stale_owner(record, lambda _: None))
        self.assertTrue(b.stale_owner(record, lambda _: 101))
        with self.assertRaises(PermissionError): b.stale_owner(record, lambda _: (_ for _ in ()).throw(PermissionError()))
    def test_secondary_instance_cannot_stop_owner(self):
        text = (source/'main.cjs').read_text()
        self.assertIn("if(primary && process.env.ALEMBIC_STOP_FILE)", text)

if __name__ == '__main__': unittest.main()
