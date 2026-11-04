import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreviewFile, PREVIEW_FILE_LIMIT} from '../frontend/src/preview-file.js';
test('large previews use the authenticated file boundary and detect concurrent size changes', async () => {
  const bytes = new Uint8Array(17 * 1024 * 1024 + 13).fill(57), calls = [];
  const client = {w: (route, query) => {calls.push({route, query}); return '/file';},
    request: async () => new Response(bytes)};
  assert.deepEqual(await readPreviewFile(client, "quoted ' $(touch leaked).wasm", bytes.length), bytes);
  assert.equal(calls[0].route, 'file');
  assert.equal(calls[0].query.path, "quoted ' $(touch leaked).wasm");
  await assert.rejects(readPreviewFile(client, 'model', bytes.length - 1), /size changed/);
  await assert.rejects(readPreviewFile(client, 'model', PREVIEW_FILE_LIMIT + 1), /128 MiB/);
  client.request = async () => {throw Error('403 Path outside project');};
  await assert.rejects(readPreviewFile(client, 'private', 1), /403/);
});
