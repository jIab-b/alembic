import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const generator = new URL('../tools/examples.mjs', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function tree(root, prefix = '') {
  const result = {};
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await tree(root, path));
    else result[path] = hash(await readFile(join(root, path)));
  }
  return result;
}
test('examples have deterministic bytes and valid history snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alembic-examples-'));
  try {
    for (const name of ['first', 'second']) {
      const result = spawnSync(process.execPath, [generator.pathname, join(root, name)], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    assert.deepEqual(await tree(join(root, 'first')), await tree(join(root, 'second')));
    const manifest = JSON.parse(await readFile(join(root, 'first/manifest.json'), 'utf8'));
    assert.equal(manifest.length, 3);
    for (const { name, file } of manifest) {
      const directory = join(root, 'first', name);
      const lines = (await readFile(join(directory, '.alembic/history.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(lines.length, file.endsWith('.svg') ? 1 : 4);
      for (const line of lines) {
        assert.deepEqual(Object.keys(line).sort(), ['at', 'bytes', 'file', 'selection', 'sha256']);
        assert.equal(new Date(line.at).toISOString(), line.at);
        assert.match(line.sha256, /^[a-f0-9]{64}$/);
        assert.equal(line.file, file);
        assert.ok(Array.isArray(line.selection) && line.selection.every(s => typeof s.id === 'string' && Array.isArray(s.center) && Array.isArray(s.objects)));
        const bytes = await readFile(join(directory, '.alembic/history', line.sha256));
        assert.equal(bytes.length, line.bytes); assert.equal(hash(bytes), line.sha256);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
