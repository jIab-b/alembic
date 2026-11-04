import assert from 'node:assert/strict';
import {renderFrame} from './render-frame.mjs';
import {drag} from './windows-checks.mjs';
export async function check({page, step}) {
  await page.evaluate(() => __alembic.open('i3d/box.i3d'));
  const frame = await renderFrame(page), box = await page.locator('.viewport').boundingBox();
  const pose = {position: [3,2,5], target: [0,0,0]};
  for (const mode of ['orbit', 'right-pan', 'shift-pan']) await step(mode, async () => {
    const deltas = [];
    for (const [dx, dy] of [[-60,0], [60,0], [0,-60], [0,60]]) {
      const point = await frame.evaluate(async pose => {
        await __alRender.setCamera(pose);
        const camera = fixture.camera, V = camera.position.constructor;
        return camera.getDirection(new V(1,0,0)).normalize().scale(.6)
          .add(camera.getDirection(new V(0,1,0)).normalize().scale(.4))
          .subtract(camera.getDirection(new V(0,0,-1)).normalize().scale(1.5)).asArray();
      }, pose);
      await page.waitForTimeout(80);
      const before = await page.evaluate(point => __alembic.project(point), point);
      const from = [box.x + box.width*.8, box.y + box.height*.7];
      if (mode === 'shift-pan') await page.keyboard.down('Shift');
      await drag(page, from, [from[0]+dx, from[1]+dy], 8, mode === 'right-pan' ? 'right' : 'left');
      if (mode === 'shift-pan') await page.keyboard.up('Shift');
      await page.waitForTimeout(80);
      const after = await page.evaluate(point => __alembic.project(point), point);
      const delta = after[dx ? 0 : 1] - before[dx ? 0 : 1];
      assert.ok(delta * (dx || dy) > 0, mode + ': scene follows drag direction');
      deltas.push(delta);
    }
    return {screenDeltas: deltas, directionsMatch: true};
  });
}
