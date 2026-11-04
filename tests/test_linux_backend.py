import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import linux_backend


class LinuxBackendTest(unittest.TestCase):
    def test_project_pin_and_toolkit_are_read_from_environment(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, HOME=tmp):
            root = Path(tmp)
            project = root / 'project'
            (project / '.alembic').mkdir(parents=True)
            (project / '.alembic/project.json').write_text('{"id":"test"}')
            for n in ('a', 'b'):
                pin = n * 40
                release = root / '.local/share/vpsctl/releases' / pin
                release.mkdir(parents=True)
                (release / 'sha').write_text(pin)
                config = {'vault_release': pin, 'toolkit': str(root / ('toolkit-' + n))}
                (project / 'environment.json').write_text(json.dumps(config))
                _, _, actual_pin, actual_config = linux_backend.project_config(project)
                self.assertEqual(actual_pin, pin)
                self.assertEqual(actual_config['toolkit'], config['toolkit'])

    def test_bad_pin_fails_before_launch(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            (project / '.alembic').mkdir()
            (project / '.alembic/project.json').write_text('{"id":"test"}')
            (project / 'environment.json').write_text('{"vault_release":"main"}')
            with self.assertRaises(ValueError):
                linux_backend.project_config(project)


if __name__ == '__main__':
    unittest.main()
