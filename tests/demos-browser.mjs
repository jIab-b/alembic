import assert from 'node:assert/strict';
import {renderFrame} from './render-frame.mjs';
export async function check({page, step, result}) {
  page.setDefaultTimeout(8000);
  for (const name of ['teleporter.i3d', 'archer.i3d', 'demon-archer.i2d']) await step(name, async () => {
    const previous = await page.locator('.viewport iframe').getAttribute('src').catch(() => '');
    await page.evaluate(path => __alembic.open('demos/' + path), name);
    let frame = await renderFrame(page, previous);
    if (name.endsWith('.i3d')) {
      const gpu = await frame.evaluate(() => {
        const runtime = window.teleporter || window.archer;
        return {backend: runtime.backend, frames: runtime.frames};
      });
      assert.match(gpu.backend, /WebGPU|WebGL2/);
      result.gpu = await page.evaluate(async () => {
        const adapter = await navigator.gpu.requestAdapter();
        return {vendor: adapter.info.vendor, fallback: adapter.isFallbackAdapter || false};
      });
      assert.equal(result.gpu.vendor, 'nvidia'); assert.equal(result.gpu.fallback, false);
    }
    if (!await page.locator('details.playback-menu').evaluate(e => e.open))
      await page.locator('summary[aria-label="Playback"]').click();
    await page.getByRole('menuitem').first().click();
    for (let pass = 0; pass < 2; pass++) {
      await page.getByRole('button', {name: 'Play replay', exact: true}).click();
      await page.waitForTimeout(350);
      if (name.endsWith('.i3d')) assert.ok(await frame.evaluate(() =>
        (window.teleporter || window.archer).time > 0));
      else assert.ok(await frame.locator('svg').count());
      if (!await page.locator('details.playback-menu').evaluate(e => e.open))
      await page.locator('summary[aria-label="Playback"]').click();
      await page.getByRole('button', {name: 'Reset to inspect', exact: true}).click();
      frame = await renderFrame(page);
      if (!await page.locator('details.playback-menu').evaluate(e => e.open))
      await page.locator('summary[aria-label="Playback"]').click();
      await page.getByRole('menuitem').first().click();
    }
    return {opened: true, played: 2, reset: 2};
  });
}
