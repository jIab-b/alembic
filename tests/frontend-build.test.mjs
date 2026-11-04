import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishFrontend} from '../backend/build-frontend.mjs';

test('live readers retain a complete asset graph while a new frontend is published', async () => {
  const temporary = process.env.TMPDIR || fileURLToPath(new URL('../.tmp/', import.meta.url));
  await mkdir(temporary, {recursive:true});
  const temp = await mkdtemp(join(temporary, 'frontend-publish-'));
  const output = join(temp, 'live'), staging = join(temp, 'next');
  let server;
  try {
    for (const directory of [output, staging]) await mkdir(join(directory, 'assets'), {recursive:true});
    await writeFile(join(output, 'index.html'), '<script src="assets/old.js"></script>');
    await writeFile(join(output, 'assets/old.js'), 'old');
    await writeFile(join(staging, 'index.html'), '<script src="assets/new.js"></script>');
    await writeFile(join(staging, 'assets/new.js'), 'new');
    for (let i=0;i<40;i++) await writeFile(join(staging, `assets/padding-${i}.js`), 'x'.repeat(65536));
    server = createServer(async (request, response) => {
      try { response.end(await readFile(join(output, request.url === '/' ? 'index.html' : request.url))); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let done = false, reads = 0;
    const publish = publishFrontend(staging, output).then(() => { done=true; });
    do {
      const response = await fetch(origin), html = await response.text();
      assert.equal(response.status, 200);
      const asset = /src="([^"]+)"/.exec(html)?.[1];
      assert.ok(asset, 'Entry is complete, never truncated');
      assert.equal((await fetch(`${origin}/${asset}`)).status, 200, 'Referenced chunk exists');
      reads++;
    } while (!done);
    await publish;
    assert.ok(reads);
    assert.match(await readFile(join(output, 'index.html'), 'utf8'), /new.js/);
    assert.equal(await readFile(join(output, 'assets/old.js'), 'utf8'), 'old', 'Open tabs retain their chunks');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(temp, {recursive:true,force:true});
  }
});
