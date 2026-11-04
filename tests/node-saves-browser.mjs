import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {mockHttp} from './mock-http.mjs';
import {windowsBrowser} from './windows-browser.mjs';
import {mockNode} from './mock-node.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return {promise, resolve}; };
const includeAudioCoverage = process.env.ALEMBIC_INCLUDE_AUDIO_TESTS === '1';
// Retained saved-state controls against mock HTTP; the thin backend returns 501 for these operations.
async function fixture() {
  const node = mockNode(), calls = [], histories = new Map(), savedContents = new Map(), failures = new Map(), holds = new Map();
  for (const path of ['scene.i3d', 'drawing.i2d', ...(includeAudioCoverage ? ['score.audio'] : [])]) node.live.set(path + '/manifest.json', Buffer.from('{}'));
  node.live.set('ordinary/notes.txt', Buffer.from('Library'));
  const server = await mockHttp(node, async (request, response, url, body) => {
    const path = url.pathname;
    if (request.headers.authorization !== 'Bearer test-token') {
      response.writeHead(401).end();
      return true;
    }
        if (path.endsWith('/node-commit') || path.endsWith('/node-saves')) {
          const data = body.length ? JSON.parse(body) : null, selected = data?.path || url.searchParams.get('path');
          calls.push({path, method: request.method, selected, data});
          let result, status = 200;
          if (path.endsWith('/node-commit')) {
            const hold = holds.get(selected); if (hold) await hold.promise;
            const failure = failures.get(selected);
            if (failure) { result = failure.body; status = failure.status; }
            else {
              const previous = histories.get(selected) || [];
              const hash = createHash('sha256').update(selected + ':' + previous.length).digest('hex');
              result = {path: selected, state: 'sha256:' + hash, files: selected.endsWith('.png') ? 1 : 3, bytes: 150,
                source_revision: 'b'.repeat(40), manifest: `.alembic/node-states/${hash}/state.json`,
                git_commit: 'd'.repeat(40), git_ref: 'refs/alembic/nodes/' + 'e'.repeat(64), git_dir: '/project/main/.git', worktree: 'main'};
              histories.set(selected, [...previous, result]);
              const prefix = selected + '/';
              const snapshot = selected.match(/\.(?:i3d|i2d|audio)$/i)
                ? [...node.live].filter(([name]) => name.startsWith(prefix))
                : [[selected, node.live.get(selected)]];
              savedContents.set(result.state, new Map(snapshot.map(([name, bytes]) => [name, Buffer.from(bytes)])));
            }
          } else result = histories.get(selected) || [];
          response.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify(result)); return true;
        }
        if (path.endsWith('/node-restore')) {
          const data = body.length ? JSON.parse(body) : {};
          calls.push({path, method:request.method, selected:data.destination, data});
          const saved = savedContents.get(data.state);
          if (!saved) { response.writeHead(404, {'Content-Type':'application/json'}).end(JSON.stringify({error:'not_found'})); return true; }
          if ([...node.live.keys()].some(name => name === data.destination || name.startsWith(data.destination + '/'))) {
            response.writeHead(409, {'Content-Type':'application/json'}).end(JSON.stringify({error:'destination_exists'})); return true;
          }
          for (const [name, bytes] of saved) node.live.set(data.destination + '/' + name, Buffer.from(bytes));
          response.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({state:data.state,destination:data.destination,files:saved.size})); return true;
        }
    return false;
  });
  return {...server, calls, histories, savedContents, failures, holds};
}

test('headless node-save UI with mock HTTP: file/package actions, pending navigation, receipts, history and errors', {timeout: 60000}, async t => {
  const server = await fixture(); let browser;
  try {
    browser = await windowsBrowser({viewport: {width: 1300, height: 850}});
    const page = await browser.context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.origin + '/#' + new URLSearchParams({node: server.origin, token: 'test-token', workspace: 'w1', vm: 'v1', agents: ''}));
    const files = page.getByRole('navigation', {name: 'Files', exact: true});
    await files.getByRole('button', {name: 'preview.png', exact: true}).waitFor();
    const menu = page.getByRole('menu', {name: 'File actions'});
    const saveItem = page.getByRole('menuitem', {name: 'Save', exact: true});
    const panel = path => page.getByRole('complementary', {name: `Saved states for ${path}`, exact: true});
    const rightClick = path => files.getByRole('button', {name: path, exact: true}).click({button: 'right'});

    if (process.env.ALEMBIC_CAPTURE_DIR) {
      const directory = process.env.ALEMBIC_CAPTURE_DIR;
      await mkdir(directory, {recursive: true});
      await page.screenshot({path: join(directory, 'workspace.png')});
      await rightClick('scene.i3d');
      await page.screenshot({path: join(directory, 'context-menu.png')});
      await page.getByRole('menuitem', {name: 'Saved states', exact: true}).click();
      await panel('scene.i3d').getByText('No saved states.').waitFor();
      await page.screenshot({path: join(directory, 'saved-states.png')});
      return;
    }

    await t.test('ordinary folders have no save action; every node-package directory does', async () => {
      await rightClick('ordinary'); assert.equal(await menu.count(), 0);
      for (const path of ['scene.i3d', 'drawing.i2d', ...(includeAudioCoverage ? ['score.audio'] : [])]) {
        await rightClick(path); assert.equal(await saveItem.isEnabled(), true);
        assert.equal(await page.getByRole('menuitem', {name: 'Shadow tree', exact: true}).isVisible(), true);
        await page.keyboard.press('Escape');
      }
    });

    await t.test('saving a file disables duplicate saves and retains the file target after navigation', async () => {
      const hold = deferred(); server.holds.set('preview.png', hold);
      await rightClick('preview.png'); await saveItem.click();
      await panel('preview.png').getByRole('status').filter({hasText: 'Saving node to tree'}).waitFor();
      await rightClick('preview.png'); assert.equal(await saveItem.isDisabled(), true);
      await page.keyboard.press('Escape');
      await files.getByRole('button', {name: 'note.txt', exact: true}).click();
      await page.locator('.viewport pre').filter({hasText: 'AFTER'}).waitFor();
      hold.resolve();
      await panel('preview.png').getByRole('status').filter({hasText: /Saved · 1 file/}).waitFor();
      const posts = server.calls.filter(call => call.method === 'POST');
      assert.deepEqual(posts.map(call => call.data), [{path: 'preview.png'}]);
      assert.equal(await page.locator('.viewport pre').textContent(), 'AFTER');
    });

    await t.test('saved-state history exposes the immutable receipt without changing the preview', async () => {
      await panel('preview.png').locator('details').filter({hasText: 'Saved states'}).first().locator('summary').first().click();
      const receipt = panel('preview.png').locator('.receipt summary').filter({hasText: /^Saved state 1/});
      assert.match(await receipt.innerText(), /Saved state 1 · 1 file/);  // ordinal label, no state hash
      await receipt.click();
      const saved = server.histories.get('preview.png')[0];
      assert.ok((await panel('preview.png').innerText()).includes(saved.state));
      assert.ok((await panel('preview.png').innerText()).includes(saved.manifest));
      await panel('preview.png').getByRole('button', {name: 'Close saved states'}).click();
      await rightClick('preview.png'); await page.getByRole('menuitem', {name: 'Saved states', exact: true}).click();
      await panel('preview.png').getByRole('button', {name: 'Refresh'}).waitFor();
      assert.equal(await panel('preview.png').locator('.receipt summary').filter({hasText: /^Saved state \d/}).count(), 1);
      assert.equal(await page.locator('.viewport pre').textContent(), 'AFTER');
    });

    await t.test('typed node directories save using the directory path and show the file count', async () => {
      for (const path of ['scene.i3d', 'drawing.i2d', ...(includeAudioCoverage ? ['score.audio'] : [])]) {
        await rightClick(path); await saveItem.click();
        await panel(path).getByRole('status').filter({hasText: /Saved · 3 files/}).waitFor();
        assert.equal(server.calls.filter(call => call.method === 'POST' && call.selected === path).length, 1);
      }
    });

    await t.test('Save receipt proves the isolate ref in the same operation and preserves the displayed working file', async () => {
      await rightClick('scene.i3d'); await page.getByRole('menuitem', {name: 'Saved states', exact: true}).click();
      const summary = panel('scene.i3d').locator('summary').filter({hasText: 'Saved receipt'});
      await summary.waitFor(); await summary.click();
      const content = await panel('scene.i3d').innerText();
      assert.match(content, /Worktree: main/);
      assert.match(content, /refs\/alembic\/nodes\//);
      assert.equal(server.calls.filter(call => call.path.endsWith('/node-commit') &&
        call.selected === 'scene.i3d').length, 1);
      assert.equal(await page.locator('.viewport pre').textContent(), 'AFTER');
      await panel('scene.i3d').locator('.receipt summary').filter({hasText: /^Saved state 1/}).click();
      const destination = panel('scene.i3d').getByRole('textbox', {name: 'Restore destination for saved state 1'});
      assert.equal(await destination.inputValue(), 'scene-restored-1');
      await panel('scene.i3d').getByRole('button', {name: 'Restore', exact: true}).click();
      await panel('scene.i3d').getByRole('status').filter({hasText: 'Restored 1 files to scene-restored-1'}).waitFor();
      assert.ok(server.node.live.has('scene-restored-1/scene.i3d/manifest.json'));
      assert.equal(server.calls.filter(call => call.path.endsWith('/node-restore')).length, 1);
      await panel('scene.i3d').getByRole('button', {name: 'Close saved states'}).click();
    });

    await t.test('a failed repeated save clears the previous success and shows the actual dependency error', async () => {
      server.failures.set('scene.i3d', {status: 422, body: {error: 'dependencies_required', fix: 'Declare dependencies in manifest.json'}});
      await rightClick('scene.i3d'); await saveItem.click();
      await panel('scene.i3d').getByRole('alert').filter({hasText: '422 dependencies_required: Declare dependencies in manifest.json'}).waitFor();
      assert.doesNotMatch(await panel('scene.i3d').getByRole('status').textContent(), /Saved ·/);
      assert.equal(server.histories.get('scene.i3d').length, 1);
      server.failures.set('preview.png', {status: 404, body: {error: 'not_found'}});
      await rightClick('preview.png'); await saveItem.click();
      await panel('preview.png').getByRole('alert').filter({hasText:
        /404 not_found.*Recursive saved states are unsupported/}).waitFor();
      assert.doesNotMatch(await panel('preview.png').getByRole('status').textContent(), /Saved ·/);
    });
    if (includeAudioCoverage) await t.test('audio node save reports declared dependency errors without claiming success', async () => {
      server.failures.set('score.audio', {status: 422, body: {error: 'dependencies_required', fix: 'Declare dependencies in manifest.json'}});
      await rightClick('score.audio'); await saveItem.click();
      await panel('score.audio').getByRole('alert').filter({hasText: '422 dependencies_required: Declare dependencies in manifest.json'}).waitFor();
      assert.doesNotMatch(await panel('score.audio').getByRole('status').textContent(), /Saved ·/);
      assert.equal(server.histories.get('score.audio').length, 1);
    });
    assert.equal(server.node.calls.some(call => /\/(?:restore|call|launch)$/.test(call.path)), false);
    assert.deepEqual(errors, []);
  } finally {
    for (const hold of server.holds.values()) hold.resolve();
    await browser?.dispose(); await server.close();
  }
});
