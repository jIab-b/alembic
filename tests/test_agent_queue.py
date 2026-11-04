import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agent_queue import Queue, run_adapter

PROGRAM = (Path(__file__).resolve().parents[1] / 'queue_vm.py').read_text()


class LocalBackend:
    """Real VM helper against an isolated test fixture, never the live project."""
    def __init__(self, directory):
        self.directory = directory

    def invoke(self, op, job, payload):
        process = subprocess.run([sys.executable, '-c', PROGRAM, op, job['id'], json.dumps(payload)],
                                 cwd=self.directory, capture_output=True, text=True)
        result = json.loads(process.stdout)
        if process.returncode:
            raise ValueError(result['error'])
        return result

    def prepare(self, job):
        return self.invoke('prepare', job, job['targets'])

    def publish(self, job, outputs, base):
        return self.invoke('publish', job, {'outputs': outputs, 'hashes': base['hashes']})

    def shell_command(self):
        return '/test/vm-shell'


class QueueTests(unittest.TestCase):
    def test_unchanged_outputs_preserve_the_original_file_and_timestamp(self):
        job=self.queue.enqueue('inspect only',['castle.glb'])
        base=self.backend.prepare(job)
        before=(self.project/'castle.glb').stat()
        result=self.backend.publish(job,{'castle.glb':base['staging']+'/castle.glb'},base)
        after=(self.project/'castle.glb').stat()
        self.assertEqual(result['unchanged'],['castle.glb'])
        self.assertEqual((before.st_ino,before.st_mtime_ns),(after.st_ino,after.st_mtime_ns))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / 'project'
        self.project.mkdir()
        (self.project / 'castle.glb').write_bytes(b'glTF\0original')
        (self.project / 'other.txt').write_text('other')
        self.backend = LocalBackend(self.project)
        self.queue = Queue('test-project', self.root / 'state')
        self.addCleanup(self.queue.db.close)

    def adapter(self, text):
        def run(config, request, shell, timeout):
            for target, staged in request['outputs'].items():
                (self.project / staged).write_bytes((self.project / target).read_bytes() + text)
            return {'outputs': request['outputs']}
        return run

    def test_binary_edits_use_same_path_and_read_latest_after_wait(self):
        first = self.queue.enqueue('first edit', ['castle.glb'])
        second = self.queue.enqueue('second edit', ['castle.glb'])
        a = self.queue.work_one(self.backend, self.adapter(b' first'))
        b = self.queue.work_one(self.backend, self.adapter(b' second'))
        self.assertEqual((a['id'], b['id']), (first['id'], second['id']))
        self.assertEqual((a['state'], b['state']), ('succeeded', 'succeeded'))
        self.assertEqual((self.project / 'castle.glb').read_bytes(), b'glTF\0original first second')
        self.assertEqual(b['base']['hashes']['castle.glb'], hashlib.sha256(b'glTF\0original first').hexdigest())
        self.assertEqual({p.name for p in self.project.iterdir()}, {'.alembic', 'castle.glb', 'other.txt'})
        self.assertFalse((self.project / '.alembic/queue.sqlite3').exists())
        notice = json.loads((self.project / '.alembic/preview.json').read_text())
        self.assertEqual(notice, {'version': 1, 'id': second['id'], 'path': 'castle.glb'})

    def test_render_handoff_prefers_scene_canvas_over_its_export(self):
        (self.project / 'Castle.canvas').write_text('{}')
        self.queue.enqueue('edit scene and export', ['castle.glb', 'Castle.canvas'])
        result = self.queue.work_one(self.backend, self.adapter(b' updated'))
        self.assertEqual(result['state'], 'succeeded')
        notice = json.loads((self.project / '.alembic/preview.json').read_text())
        self.assertEqual(notice['path'], 'Castle.canvas')

    def test_overlap_fifo_allows_disjoint_concurrency(self):
        first = self.queue.enqueue('one', ['castle.glb'])
        second = self.queue.enqueue('two', ['castle.glb', 'other.txt'])
        third = self.queue.enqueue('three', ['other.txt'])
        (self.project / 'free.txt').write_text('free')
        fourth = self.queue.enqueue('four', ['free.txt'])
        active, lock = self.queue.claim()
        self.addCleanup(os.close, lock)
        self.assertEqual(active['id'], first['id'])
        q2 = Queue('test-project', self.root / 'state')
        self.addCleanup(q2.db.close)
        next_job, next_lock = q2.claim()
        self.addCleanup(os.close, next_lock)
        self.assertEqual(next_job['id'], fourth['id'])
        self.assertIsNone(q2.claim())
        self.assertEqual(q2.get(second['id'])['state'], 'queued')
        self.assertEqual(q2.get(third['id'])['state'], 'queued')

    def test_stale_target_blocks_publish_and_preserves_external_change(self):
        self.queue.enqueue('update', ['castle.glb'])
        adapter = self.adapter(b' proposed')
        def race(*args):
            result = adapter(*args)
            (self.project / 'castle.glb').write_bytes(b'external newer')
            return result
        result = self.queue.work_one(self.backend, race)
        self.assertEqual(result['state'], 'failed')
        self.assertIn('stale base', result['error'])
        self.assertEqual((self.project / 'castle.glb').read_bytes(), b'external newer')

    def test_disjoint_inventory_and_publication_wait_for_managed_temps(self):
        first = self.queue.enqueue('first', ['castle.glb'])
        second = self.queue.enqueue('second', ['other.txt'])
        base = self.backend.prepare(first)
        first_out = base['staging'] + '/castle.glb'
        (self.project / first_out).write_bytes(b'first published')
        payload = {'outputs': {'castle.glb': first_out}, 'hashes': base['hashes']}
        runner = self.root / 'concurrent-helper.py'
        runner.write_text('''import json, pathlib, sys, time
namespace = {'__name__': 'queue_vm_test'}
exec(pathlib.Path(sys.argv[1]).read_text(), namespace)
mode, job, payload, signals = sys.argv[2], sys.argv[3], json.loads(sys.argv[4]), pathlib.Path(sys.argv[5])
if mode == 'hold':
    original = namespace['os'].replace
    def hold(*args, **kwargs):
        (signals / 'held').touch()
        deadline = time.monotonic() + 10
        while not (signals / 'release').exists():
            if time.monotonic() > deadline: raise TimeoutError('publisher release')
            time.sleep(.01)
        return original(*args, **kwargs)
    namespace['os'].replace = hold
    result = namespace['execute']('publish', job, payload)
else:
    original = namespace['fcntl'].flock
    def contend(fd, flags):
        try:
            original(fd, flags | namespace['fcntl'].LOCK_NB)
        except BlockingIOError:
            (signals / 'contended').write_text('blocked')
        return original(fd, flags)
    namespace['fcntl'].flock = contend
    inventory = namespace['inventory']
    def observed_inventory():
        (signals / 'inventoried').touch()
        return inventory()
    namespace['inventory'] = observed_inventory
    base = namespace['execute']('prepare', job, ['other.txt'])
    staged = base['staging'] + '/other.txt'
    pathlib.Path(staged).write_bytes(b'second published')
    result = namespace['execute']('publish', job, {'outputs': {'other.txt': staged}, 'hashes': base['hashes']})
print(json.dumps(result))
''')

        def start(mode, job, data):
            return subprocess.Popen([sys.executable, str(runner),
                                     str(Path(__file__).resolve().parents[1] / 'queue_vm.py'),
                                     mode, job['id'], json.dumps(data), str(self.root)],
                                    cwd=self.project, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        def wait_for(name, process):
            deadline = time.monotonic() + 5
            while not (self.root / name).exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    self.fail('helper did not reach ' + name)
                time.sleep(.01)

        processes = []
        try:
            publisher = start('hold', first, payload)
            processes.append(publisher)
            wait_for('held', publisher)
            self.assertEqual(len(list(self.project.glob('.tmp/.agent-queue-*'))), 1)
            subprocess.run(['git','init','--quiet'],cwd=self.project,check=True)
            (self.project/'.git/info/exclude').write_text('.tmp/\n')
            listed=subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=self.project,text=True)
            self.assertNotIn('.agent-queue-',listed)
            competitor = start('compete', second, {})
            processes.append(competitor)
            wait_for('contended', competitor)
            self.assertFalse((self.root / 'inventoried').exists())
            (self.root / 'release').touch()
            for process in processes:
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 0, stderr)
                self.assertIn('published', json.loads(stdout))
            self.assertEqual((self.project / 'castle.glb').read_bytes(), b'first published')
            self.assertEqual((self.project / 'other.txt').read_bytes(), b'second published')
            baseline = json.loads((self.project / '.alembic/queue' / second['id'] / 'base.json').read_text())
            self.assertFalse(any('.agent-queue-' in p for p in baseline['inventory']))
            self.assertEqual(list(self.project.glob('.agent-queue-*')), [])
        finally:
            (self.root / 'release').touch()
            for process in processes:
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=5)

    def test_undeclared_target_or_copy_is_never_published(self):
        self.queue.enqueue('update', ['castle.glb'])
        def adapter(*args):
            return {'outputs': {'castle_v2.glb': 'whatever'}}
        result = self.queue.work_one(self.backend, adapter)
        self.assertEqual(result['state'], 'failed')
        self.assertIn('undeclared', result['error'])
        self.assertFalse((self.project / 'castle_v2.glb').exists())
        self.assertEqual((self.project / 'castle.glb').read_bytes(), b'glTF\0original')

    def test_detects_adapter_creating_unmanaged_fork(self):
        self.queue.enqueue('update', ['castle.glb'])
        stage = self.adapter(b' staged')
        def adapter(*args):
            result = stage(*args)
            (self.project / 'castle_v2.glb').write_bytes(b'unmanaged')
            return result
        result = self.queue.work_one(self.backend, adapter)
        self.assertEqual(result['state'], 'failed')
        self.assertIn('outside staging', result['error'])
        self.assertEqual((self.project / 'castle.glb').read_bytes(), b'glTF\0original')
        # The executor does not delete unmanaged agent/user files to hide a violation.
        self.assertTrue((self.project / 'castle_v2.glb').exists())

    def test_multitarget_stale_preflight_prevents_partial_publish(self):
        self.queue.enqueue('update both', ['castle.glb', 'other.txt'])
        stage = self.adapter(b' staged')
        def adapter(*args):
            result = stage(*args)
            (self.project / 'other.txt').write_text('newer')
            return result
        result = self.queue.work_one(self.backend, adapter)
        self.assertEqual(result['state'], 'failed')
        self.assertEqual((self.project / 'castle.glb').read_bytes(), b'glTF\0original')
        self.assertEqual((self.project / 'other.txt').read_text(), 'newer')

    def test_symlink_and_escape_targets_rejected(self):
        for path in ('../outside', '/absolute', 'castle.glb/../other.txt', '.alembic/foo', 'a//b', './castle.glb'):
            with self.assertRaises(ValueError):
                self.queue.enqueue('edit', [path])
        outside = self.root / 'outside'
        outside.write_text('safe')
        (self.project / 'link').symlink_to(outside)
        self.queue.enqueue('edit', ['link'])
        result = self.queue.work_one(self.backend, self.adapter(b' nope'))
        self.assertEqual(result['state'], 'failed')
        self.assertEqual(outside.read_text(), 'safe')

    def test_staged_symlink_rejected_before_any_write(self):
        self.queue.enqueue('edit', ['castle.glb'])
        def adapter(config, request, shell, timeout):
            staged = self.project / request['outputs']['castle.glb']
            staged.unlink()
            staged.symlink_to(self.project / 'other.txt')
            return {'outputs': request['outputs']}
        result = self.queue.work_one(self.backend, adapter)
        self.assertEqual(result['state'], 'failed')
        self.assertEqual((self.project / 'castle.glb').read_bytes(), b'glTF\0original')

    def test_bundle_staging_keeps_unchanged_resources_valid(self):
        self.queue.enqueue('edit one bundle member', ['castle.glb', 'other.txt'])
        def adapter(config, request, shell, timeout):
            (self.project / request['outputs']['castle.glb']).write_bytes(b'glTF\0changed')
            return {'outputs': request['outputs']}
        result = self.queue.work_one(self.backend, adapter)
        self.assertEqual(result['state'], 'succeeded')
        self.assertEqual((self.project / 'castle.glb').read_bytes(), b'glTF\0changed')
        self.assertEqual((self.project / 'other.txt').read_text(), 'other')

    def test_explicit_recording_export_is_distinct_from_an_unmanaged_fork(self):
        job = self.queue.enqueue('edit', ['castle.glb'])
        base = self.backend.prepare(job)
        staged = '.alembic/experiments/recording/clip.mp4'
        path = self.project / staged
        path.parent.mkdir(parents=True)
        path.write_bytes(b'recorded user journey')
        exported = self.backend.invoke('recordings', job, {'jobs': [job['id']], 'outputs': {'test_vids/clip.mp4': staged}})
        self.assertIn('test_vids/clip.mp4', exported['recordings'])
        proposal = self.adapter(b' edited')({}, {'outputs': {'castle.glb': base['staging'] + '/castle.glb'}}, '', 10)
        result = self.backend.publish(job, proposal['outputs'], base)
        self.assertEqual(result['published'], ['castle.glb'])
        self.assertEqual((self.project / 'test_vids/clip.mp4').read_bytes(), b'recorded user journey')

    def test_worker_crash_is_interrupted_and_never_automatically_replayed(self):
        job = self.queue.enqueue('edit', ['castle.glb'])
        _, lock = self.queue.claim()
        os.close(lock)  # kernel releases this on a worker crash
        reopened = Queue('test-project', self.root / 'state')
        self.addCleanup(reopened.db.close)
        self.assertIsNone(reopened.claim())
        self.assertEqual(reopened.get(job['id'])['state'], 'interrupted')
        retry = reopened.retry(job['id'])
        self.assertNotEqual(retry['id'], job['id'])
        self.assertEqual(retry['state'], 'queued')

    def test_crash_after_publication_is_not_automatically_reapplied(self):
        job = self.queue.enqueue('append once', ['castle.glb'])
        active, lock = self.queue.claim()
        base = self.backend.prepare(active)
        request = {'outputs': {'castle.glb': base['staging'] + '/castle.glb'}}
        proposal = self.adapter(b' once')({}, request, '', 10)
        self.backend.publish(active, proposal['outputs'], base)
        # Simulate SIGKILL after VM publication but before SQLite completion.
        os.close(lock)
        self.assertIsNone(self.queue.work_one(self.backend, self.adapter(b' twice')))
        self.assertEqual(self.queue.get(job['id'])['state'], 'interrupted')
        self.assertEqual((self.project / 'castle.glb').read_bytes(), b'glTF\0original once')

    def test_native_codex_adapter_uses_schema_and_last_message_without_model(self):
        executable = self.root / 'codex'
        executable.write_text('''#!/usr/bin/env python3
import json,pathlib,sys
args=sys.argv
assert args[1:4] == ['exec', '--ephemeral', '--skip-git-repo-check']
schema=json.loads(pathlib.Path(args[args.index('--output-schema')+1]).read_text())
assert schema['additionalProperties'] is False
request=json.loads(sys.stdin.read().rsplit('\\n',1)[-1])
pathlib.Path(args[args.index('--output-last-message')+1]).write_text(json.dumps({'outputs':request['outputs']}))
print('native agent diagnostic stream is not the proposal')
''')
        executable.chmod(0o700)
        request = {'targets': ['castle.glb'], 'outputs': {'castle.glb': '.alembic/queue/job/out/castle.glb'}}
        with patch.dict(os.environ, {'PATH': str(self.root) + os.pathsep + os.environ['PATH']}):
            result = run_adapter({'agent': 'codex'}, request, '/test/shell', 10)
        self.assertEqual(result, {'outputs': request['outputs']})

    def test_missing_file_fails_without_creating_it(self):
        self.queue.enqueue('edit', ['missing.glb'])
        result = self.queue.work_one(self.backend, self.adapter(b' nope'))
        self.assertEqual(result['state'], 'failed')
        self.assertFalse((self.project / 'missing.glb').exists())

    def test_generic_adapter_receives_request_and_vm_shell(self):
        script = "import json,os,sys; r=json.load(sys.stdin); assert os.environ['VPS_SHELL']=='/test/shell'; print(json.dumps({'outputs':r['outputs']}))"
        request = {'outputs': {'castle.glb': '.alembic/queue/test/out/castle.glb'}}
        result = run_adapter({'argv': [sys.executable, '-c', script]}, request, '/test/shell', 10)
        self.assertEqual(result, {'outputs': request['outputs']})

    def test_cancel_is_durable_and_never_runs(self):
        job = self.queue.enqueue('edit', ['castle.glb'])
        self.queue.cancel(job['id'])
        self.assertIsNone(self.queue.claim())
        self.assertEqual(self.queue.get(job['id'])['state'], 'cancelled')


if __name__ == '__main__':
    unittest.main()
