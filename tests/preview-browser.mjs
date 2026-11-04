import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {png} from './fixture.mjs';
const require = createRequire(import.meta.url);
// Vault's real static-file policy: a network response cannot be embedded. The
// isolated preview server deliberately relaxes only its packaged wrapper assets.
const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self' blob: ws://127.0.0.1:* ws://localhost:*; frame-src blob: http://127.0.0.1:* http://localhost:*; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
const files = new Map([
  ['index.html', '<!doctype html><html><head><link rel="stylesheet" href="app.css"></head><body><p id="result">Loading</p><img id="image" src="pixel.png"><script type="module" src="app.js"></script></body></html>'],
  ['app.css', '#result { color: rgb(12, 34, 56); }'],
  ['answer.js', 'export const answer = 42;'],
  ['data.json', '{"message":"Loaded"}'],
  ['answer.wasm', Buffer.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,42,11])],
  ['pixel.png', png],
  ['app.js', `import {answer} from './answer.js';
    const data = await (await fetch('data.json')).json();
    const {instance} = await WebAssembly.instantiateStreaming(fetch('answer.wasm'));
    let isolated = false; try { parent.parent.sessionStorage.getItem('secret'); } catch { isolated = true; }
    document.querySelector('#result').textContent = data.message + ' ' + answer + ' ' + instance.exports.answer() + ' ' + isolated;
  `]
]);
const encoded = Object.fromEntries([...files].map(([path, bytes]) => [path, [...Buffer.from(bytes)]]));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
async function fixture() {
  let controllerOrigin, previewOrigin;
  const reads = [], networkApps = [];
  const controller = createServer(async (request, response) => {
    let body, type = 'text/html';
    if (request.url === '/') body = '<!doctype html><script type="module" src="/harness.js"></script>';
    else if (request.url === '/preview.js') { body = await readFile(new URL('../frontend/src/preview.js', import.meta.url)); type = 'text/javascript'; }
    else if (request.url === '/manifest.json') { body = JSON.stringify({controller: controllerOrigin, workspaces: {w1: previewOrigin}}); type = 'application/json'; }
    else if (request.url === '/harness.js') {
      type = 'text/javascript';
      body = `import {discoverPreview} from '/preview.js';
        sessionStorage.setItem('secret', 'controller-token');
        const preview = await discoverPreview({workspace:'w1'}, '/manifest.json');
        const files = ${JSON.stringify(encoded)};
        const frame = document.createElement('iframe');
        addEventListener('message', ({data, source, origin}) => {
          if (source !== frame.contentWindow || origin !== preview || data?.type !== 'alembic.read') return;
          fetch('/read?' + encodeURIComponent(data.path));
          const bytes = files[data.path];
          source.postMessage({type:'alembic.file', id:data.id, ...(bytes?{bytes:new Uint8Array(bytes).buffer}:{error:'Missing'})}, preview);
        });
        frame.src = preview + '/assets/play/index.html#' + new URLSearchParams({host:location.origin,session:'s1',entry:'index.html'});
        document.body.append(frame);`;
    } else if (request.url.startsWith('/read?')) { reads.push(decodeURIComponent(request.url.slice(6))); body = ''; }
    else { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, {'Content-Type': type, 'Content-Security-Policy': policy, 'Cache-Control': 'no-store'}); response.end(body);
  });
  controllerOrigin = await listen(controller);
  // Exercise the production preview server and its actual response headers.
  const helper = spawn('python3', ['-u', '-c', `
import sys, threading
from preview_server import preview_http_server
server = preview_http_server(sys.argv[1], sys.argv[2])
print('http://127.0.0.1:' + str(server.server_port), flush=True)
threading.Thread(target=lambda: (sys.stdin.read(), server.shutdown()), daemon=True).start()
server.serve_forever()
server.server_close()
`, new URL('../frontend/public/assets/', import.meta.url).pathname, controllerOrigin],
    {cwd: new URL('..', import.meta.url), stdio:['pipe','pipe','inherit'], env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  const lines = createInterface({input:helper.stdout});
  [previewOrigin] = await Promise.race([once(lines, 'line'), once(helper, 'exit').then(([code]) => { throw new Error('Preview helper exited: '+code); })]);
  return {origin: controllerOrigin, preview: previewOrigin, reads, networkApps, close: async () => {
    const exited=once(helper,'exit');helper.stdin.end();await exited;lines.close();await close(controller);
  }};
}
for (const name of ['firefox', 'chromium']) test(`${name}: isolated preview loads real resources after cold, normal, hard and restarted navigation`, {timeout:90000}, async t => {
  let playwright;
  try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
  catch (error) { if (error.code === 'MODULE_NOT_FOUND') { t.skip('Playwright is unavailable'); return; } throw error; }
  const root = await mkdtemp(join(tmpdir(), 'alembic-preview-browser-')), server = await fixture();
  let context;
  const launch = () => playwright[name].launchPersistentContext(root, {headless:true,
    executablePath: name === 'firefox' ? process.env.FIREFOX_PATH : process.env.CHROMIUM_PATH,
    args: name === 'chromium' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []});
  try {
    try { context = await launch(); }
    catch (error) { if (/executable doesn't exist|ENOENT|error while loading shared libraries/i.test(error.message)) { t.skip('Browser unavailable'); return; } throw error; }
    const observe = page => page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/assets/play/app/') && !response.fromServiceWorker()) server.networkApps.push(response.url());
    });
    let page = await context.newPage(); observe(page);
    const verify = async () => {
      const app = page.frameLocator('iframe').frameLocator('iframe');
      await app.locator('#result').filter({hasText:'Loaded 42 42 true'}).waitFor({timeout:15000});
      await app.locator('#image').evaluate(image => image.decode());
      assert.equal(await app.locator('#image').evaluate(image => image.complete && image.naturalWidth), 1);
      assert.equal(await app.locator('#result').evaluate(element => getComputedStyle(element).color), 'rgb(12, 34, 56)');
    };
    await page.goto(server.origin); await verify();
    await page.reload(); await verify();
    if (name === 'firefox') {
      // Firefox's supported forceGet flag reproduces Shift+Reload, including its
      // service-worker bypass on newly inserted descendant frames.
      await Promise.all([page.waitForEvent('load'), page.evaluate(() => { setTimeout(() => location.reload(true), 0); })]);
      await verify();
    }
    await context.close(); context = await launch(); page = await context.newPage(); observe(page);
    await page.goto(server.origin); await verify();
    assert.deepEqual(server.networkApps, [], 'authored files must never reach the HTTP server');
    for (const path of files.keys()) assert.ok(server.reads.includes(path), 'VM file relay: ' + path);
    const headers = await (await fetch(server.preview + '/assets/play/index.html')).headers;
    assert.match(headers.get('content-security-policy'), new RegExp(server.origin.replaceAll('.', '\\.')));
    assert.equal((await fetch(server.preview + '/w/w1/file')).status, 404);
    assert.equal((await fetch(server.preview + '/assets/play/app/s1/index.html')).status, 404);
  } finally { await context?.close(); await server.close(); await rm(root, {recursive:true, force:true}); }
});
