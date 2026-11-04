import test from 'node:test';
import assert from 'node:assert/strict';
import {registry, requireBackend} from '../render/registry.js';
import {assertPort} from '../frontend/src/contract/ports.js';
import {readExports} from '../frontend/src/contract/rules.js';
import {createStub, broken} from './fixtures/render/stub.js';
import {conform} from './port-conformance.mjs';
import {fixtures} from './port-fixtures.mjs';
export function portSuite(port) {
test(port + ' registry rows declare a loader and bounded file types', () => {
  for (const row of registry.filter(row => row.port === port && !row.unsupported)) {
    assert.equal(typeof row.loader, 'function'); assert.ok(row.extensions.length);
    assert.ok(fixtures[row.formats[0]], 'Add a conformance fixture for ' + row.formats[0]);
    for (const format of row.formats) assert.equal(requireBackend(format), row);
  }
});
test(port + ' accepts a test-only registered adapter without frontend edits and rejects a broken one', async () => {
  const row = {formats: ['test-' + port], port, extensions: ['fixture'], kind: 'app',
    loader: async () => createStub(port)};
  registry.push(row);
  try {
    const source = `exports-index\t1\nrender\tmain\t${row.formats[0]}\tscene.fixture\n`;
    assert.equal(readExports(new TextEncoder().encode(source), 'test.' + port).nodes[0].format, row.formats[0]);
    await conform(port, await requireBackend(row.formats[0]).loader());
    assert.throws(() => assertPort(port, broken(port)), /render contract missing: reset/);
  } finally { registry.splice(registry.indexOf(row), 1); }
});
}
