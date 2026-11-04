import assert from 'node:assert/strict';
import {renderFrame} from './render-frame.mjs';
import {registry} from '../render/registry.js';
import {fixtures} from './port-fixtures.mjs';
import {ports} from '../frontend/src/contract/ports.js';
export async function check({page, step, result, file}) {
  page.setDefaultTimeout(6000);
  const open = async path => {
    const previous = await page.locator('.viewport iframe').getAttribute('src').catch(() => '');
    await page.evaluate(path => __alembic.open(path), path);
    return renderFrame(page, previous);
  };
  const rows = [...registry.filter(row => ports[row.port] && !row.unsupported),
    {formats: ['stub2d'], port: 'i2d', kind: 'app'}];
  for (const row of rows) await step('conformance-' + row.formats[0], async () => {
    const path = fixtures[row.formats[0]] || (row.formats[0] === 'stub2d' ? 'stub.i2d' : null), port = row.port;
    assert.ok(path, 'Add a conformance fixture for ' + row.formats[0]);
    let frame;
    if (row.kind === 'model') {
      await page.evaluate(path => __alembic.open(path), path);
      await page.waitForFunction(() => __alembic.state().kind === 'model' && __alembic.pose());
      await page.evaluate(async bytes => {
        const url = performance.getEntriesByType('resource').find(e => /babylon-viewer-[^/]+\.js/.test(e.name)).name;
        const {createViewer} = await import(url);
        const host = document.createElement('div');
        Object.assign(host.style, {width: '400px', height: '240px', position: 'fixed', inset: '0'});
        document.body.append(host);
        const view = await createViewer(host, () => {}, () => {});
        await view.load(new Uint8Array(bytes), null, 'model.glb');
        await view.configure({render: 'main', scenarios: [], interaction: {}, onInteraction() {}, reset() {}});
        window.__conformance = {render: view.render, dispose() {view.dispose(); host.remove();}};
      }, [...await file(path + '/model.glb')]);
      frame = page;
    } else frame = await open(path);
    const actual = await frame.evaluate(() => (window.__conformance?.render || __alRender).methods);
    assert.deepEqual([...actual].sort(), [...ports[port]].sort());
    const observed = await frame.evaluate(async port => {
      const surface = window.__conformance?.render || __alRender;
      const events = ['onReady','onPlayback','onFailure', ...(port === 'i3d' ? ['onCamera'] : [])];
      for (const name of events) {
        const off = surface[name](() => {});
        if (typeof off !== 'function') throw Error('No unsubscribe: ' + name);
        off();
      }
      await surface.setIO({io_lock: false});
      if (port !== 'audio') {
        await surface.setViewport({width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio});
        await surface.drawShapes([], {color: '#e28a67', alpha: .18});
        const bytes = await surface.capture([0,0,.25,.25]);
        if (!(bytes?.byteLength || bytes?.length)) throw Error('Capture returned no pixels');
      } else if (!Number.isFinite(await surface.time())) throw Error('Audio time is not finite');
      if (port === 'i3d') {
        await surface.pick([innerWidth/2,innerHeight/2]);
        await surface.objects({shape: 'sphere', center: [0,0,0], radius: 1});
      }
      return {methods: surface.methods, capture: port !== 'audio'};
    }, port);
    if (row.kind === 'model') await page.evaluate(() => {
      __conformance.dispose(); delete window.__conformance;
    });
    return observed;
  });
  await step('broken-adapter-fails-visibly', async () => {
    await page.evaluate(() => __alembic.open('broken.i2d'));
    await page.locator('.status').filter({hasText: 'i2d render contract missing:'}).waitFor();
    result.errors = result.errors.filter(error => error.includes('i2d render contract missing:') === false);
    return true;
  });
  await step('unsupported-godot-fails-visibly', async () => {
    await page.evaluate(() => __alembic.open('unsupported.i3d'));
    await page.locator('.status').filter({hasText: 'Godot is unsupported for now'}).waitFor();
    return true;
  });
}
