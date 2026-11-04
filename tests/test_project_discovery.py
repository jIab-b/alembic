import json
from pathlib import Path
import tempfile
import unittest

import project_discovery as discovery


class DiscoveryTest(unittest.TestCase):
    def test_moved_new_and_skipped_projects(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = root / 'settings.txt'
            settings.write_text(json.dumps({'schema_version': 1, 'search_roots': [str(root)]}), encoding='utf-8')
            def project(path, identity):
                (path / '.alembic').mkdir(parents=True)
                (path / '.alembic/project.json').write_text(json.dumps({'id': identity}), encoding='utf-8')
            project(root / 'old', 'one')
            project(root / 'vendor/ignored', 'hidden')
            self.assertEqual([p['id'] for p in discovery.discover_projects(settings)], ['one'])
            (root / 'old').rename(root / 'moved')
            project(root / 'new', 'two')
            try:
                (root / 'loop').symlink_to(root, target_is_directory=True)
            except OSError:
                pass
            found = discovery.discover_projects(settings)
            self.assertEqual({p['id'] for p in found}, {'one', 'two'})
            self.assertEqual(next(p['path'] for p in found if p['id'] == 'one'), str(root / 'moved'))

    def test_duplicate_ids_and_metadata_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = root / 'settings.txt'
            settings.write_text(json.dumps({'schema_version': 1, 'search_roots': [str(root)]}), encoding='utf-8')
            for name in ('first', 'second'):
                meta = root / name / '.alembic'
                meta.mkdir(parents=True)
                (meta / 'project.json').write_text(json.dumps({'id': 'same', 'secret': 'do-not-expose'}), encoding='utf-8')
            meta = root / 'large' / '.alembic'
            meta.mkdir(parents=True)
            (meta / 'project.json').write_text(' ' * 65537, encoding='utf-8')
            found = discovery.discover_projects(settings)
            self.assertEqual(len(found), 2)
            self.assertTrue(all(row['ambiguous'] for row in found))
            self.assertNotIn('do-not-expose', json.dumps(found))

    def test_invalid_settings_are_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Path(tmp) / 'settings.txt'
            settings.write_text('{"schema_version": 99}', encoding='utf-8')
            with self.assertRaises(ValueError):
                discovery.discover_projects(settings)

    def test_version_contract(self):
        self.assertEqual(discovery.version_info()['protocol_version'], 1)
        self.assertIn('discover_projects', discovery.version_info()['capabilities'])


if __name__ == '__main__':
    unittest.main()
