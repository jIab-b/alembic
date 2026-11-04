// Run through tests/windows-run.py with ALEMBIC_CHECK pointing at this module.
// Exercises the existing frontend and its actual renderer bridge, not a stand-in UI.
import assert from 'node:assert/strict';
import {renderFrame} from './render-frame.mjs';

const node = 'test_scene/arena.i3d';

export async function check({page, step, shot, file, result}) {
  page.setDefaultTimeout(7000);
  let frame;
  const rendered = target => target.waitForFunction(() => {
    const scene = window.testScene?.scene || window.nodePreview?.scene;
    return scene?.isReady() && scene.getRenderId() > 2 && scene.getActiveMeshes().length > 0;
  });
  const visiblePixels = async () => {
    let colors = 0;
    for (let attempt = 1; attempt <= 20; attempt++) {
      const png = await page.locator('.viewport').screenshot();
      colors = await page.evaluate(async bytes => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + bytes;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const context = canvas.getContext('2d');
        // Ignore the viewport border: only rendered content counts as evidence.
        context.drawImage(image, image.width * .05, image.height * .05,
          image.width * .9, image.height * .9, 0, 0, 64, 64);
        const pixels = context.getImageData(0, 0, 64, 64).data, values = new Set();
        for (let i = 0; i < pixels.length; i += 4)
          values.add(pixels.slice(i, i + 3).join(','));
        return values.size;
      }, png.toString('base64'));
      if (colors > 16) return {colors, attempts: attempt};
      // Shader readiness precedes the browser compositor presenting the frame.
      if (attempt < 20) await page.waitForTimeout(100);
    }
    assert.ok(colors > 16, 'Rendered viewport must contain visible geometry, not only a clear color; colors=' + colors);
  };
  const ready = async (previous = '') => {
    frame = await renderFrame(page, previous);
    await frame.waitForFunction(() => !!window.testScene?.snapshot);
    await page.waitForFunction(() => document.querySelector('[aria-label="io_lock"]')?.disabled === false);
    await rendered(frame);
    return frame.evaluate(() => testScene.snapshot());
  };
  const menu = page.locator('details.playback-menu');
  const showMenu = async () => {
    if (!await menu.evaluate(element => element.open))
      await page.locator('summary[aria-label="Playback"]').click();
  };
  const rows = (await file(node + '/playbacks.txt')).toString().split('\n')
    .map(line => line.split('\t')).filter(row => row[0] === 'scenario');
  const labels = new Map(rows.map(row => [row[1], row[2]]));
  const renders = new Map((await file(node + '/exports.txt')).toString().split('\n')
    .map(line => line.split('\t')).filter(row => row[0] === 'render').map(row => [row[1], node + '/' + row[3]]));
  const source = () => page.locator('.viewport iframe').getAttribute('src');
  const select = async id => {
    const previous = await source(), before = await page.evaluate(() => __alembic.state().file);
    const target = renders.get(rows.find(row => row[1] === id)[3]);
    await showMenu();
    await page.getByRole('menuitem').filter({hasText: labels.get(id)}).click();
    await page.waitForFunction(target => __alembic.state().file === target, target);
    await page.waitForFunction(() => document.querySelector('[aria-label="Play replay"]')?.disabled === false);
    return ready(before === target ? '' : previous);
  };
  const reset = async () => {
    const previous = await source(), before = await page.evaluate(() => __alembic.state().file);
    await showMenu();
    await page.getByRole('button', {name: 'Reset to inspect', exact: true}).click();
    await page.waitForFunction(target => __alembic.state().file === target, renders.get('main'));
    await page.waitForFunction(() => document.querySelector('[aria-label="Play replay"]')?.disabled === true);
    return ready(before === renders.get('main') ? '' : previous);
  };

  await step('compositionOpen', async () => {
    await page.waitForFunction(() => !!window.__alembic);
    await page.evaluate(path => __alembic.open(path), node);
    const initial = await ready();
    assert.equal(initial.variant, 'standard');
    assert.equal(initial.io, false);
    assert.equal(initial.enemies.length, 2);
    assert.ok(initial.enemies.every(enemy => enemy.enabled && enemy.health > 0));
    assert.equal(initial.bomb.enabled, true);
    assert.equal(initial.bomb.armed, false);
    const gpu = await frame.evaluate(() => {
      const engine = testScene.scene.getEngine();
      return {info: engine.getGlInfo(), meshes: testScene.scene.meshes.length};
    });
    assert.ok(gpu.meshes > 10, 'The composed scene contains rendered geometry');
    assert.doesNotMatch(JSON.stringify(gpu.info), /swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i);
    result.gpu = gpu.info;
    const pixels = await visiblePixels();
    await shot('composition-overview');
    return {initial, ...gpu, pixels};
  });
  if (!frame) return;

  await step('renderVariations', async () => {
    const entries = [...renders.entries()], opened = [];
    assert.equal(entries.length, 4);
    // The existing menu labels all Babylon entries identically; declared order
    // is the stable way to select them without changing the viewer's controls.
    for (const index of [1, 2, 3, 0]) {
      const [id, target] = entries[index], previous = await source();
      await page.getByRole('button', {name: 'Render', exact: true}).click();
      const options = page.getByRole('menu', {name: 'Render views'}).getByRole('menuitemradio');
      assert.equal(await options.count(), 4);
      await options.nth(index).click();
      await page.waitForFunction(target => __alembic.state().file === target, target);
      const state = await ready(previous);
      assert.equal(state.variant, id === 'main' ? 'standard' : id);
      assert.equal(state.bomb.armed, false);
      assert.equal(state.bomb.exploded, false);
      assert.equal(state.bomb.enabled, id !== 'safe-bomb');
      assert.equal(state.enemies[0].enabled, true);
      assert.equal(state.enemies[1].enabled, id !== 'one-enemy');
      assert.equal(state.bomb.blastRadius, id === 'wide' ? 6 : 3.2);
      assert.ok(state.enemies.every(enemy => enemy.health > 0));
      assert.equal(state.io, false, 'Switching render targets starts in inspection');
      opened.push({id, file: target, variant: state.variant});
    }
    return opened;
  });

  await step('nodeIsolationAndCleanup', async () => {
    const evidence = await frame.evaluate(() => {
      testScene.configure('standard');
      const count = () => ({meshes: testScene.scene.meshes.length,
        materials: testScene.scene.materials.length, cameras: testScene.scene.cameras.length});
      const baseline = count(), player = testScene.nodes.player;
      const [first, second] = testScene.nodes.enemies;
      first.enabled = false;
      const independentEnable = second.enabled && first !== second;
      first.enabled = true;
      first.damage(25);
      const health = testScene.nodes.enemies.map(enemy => enemy.snapshot().health);
      testScene.nodes.bomb.explode();
      const counts = [];
      for (let round = 0; round < 5; round++) {
        for (const variant of testScene.variants) {
          testScene.configure(variant);
          counts.push(count());
        }
      }
      testScene.configure('standard');
      return {baseline, counts, independentEnable, health,
        samePlayer: player === testScene.nodes.player, reset: testScene.snapshot()};
    });
    assert.equal(evidence.independentEnable, true, 'Each enemy has independent enabled state');
    assert.deepEqual(evidence.health, [75, 100], 'Damage to one instance does not change the other');
    assert.equal(evidence.samePlayer, true, 'Reconfiguration retains the player and input listeners');
    for (const count of evidence.counts) assert.deepEqual(count, evidence.baseline,
      'Replacing child instances disposes their meshes and materials');
    assert.equal(evidence.reset.bomb.exploded, false);
    assert.equal(evidence.reset.bomb.armed, false);
    assert.ok(evidence.reset.enemies.every(enemy => enemy.enabled && enemy.health === 100));
    return {baseline: evidence.baseline, reconfigurations: evidence.counts.length,
      independentEnable: true, independentHealth: true, restored: true};
  });

  await step('ioWithoutPlayback', async () => {
    const before = await frame.evaluate(() => testScene.snapshot().player.position);
    await page.getByRole('button', {name: 'io_lock', exact: true}).click();
    await frame.waitForFunction(() => testScene.snapshot().io);
    await page.keyboard.down('w');
    await page.waitForTimeout(250);
    await page.keyboard.up('w');
    const moved = await frame.evaluate(() => testScene.snapshot());
    assert.ok(Math.hypot(...moved.player.position.map((value, i) => value - before[i])) > .1,
      'WASD changes the first-person player position without selecting playback');
    assert.equal(moved.bomb.armed, false);
    await page.keyboard.press('Escape');
    await frame.waitForFunction(() => !testScene.snapshot().io);
    const stopped = await frame.evaluate(() => testScene.snapshot().player.position);
    await page.waitForTimeout(160);
    assert.deepEqual(await frame.evaluate(() => testScene.snapshot().player.position), stopped,
      'Releasing IO clears movement without momentum');
    return {before, moved: moved.player.position, released: true};
  });

  for (const variant of ['standard', 'one-enemy', 'safe-bomb', 'wide']) {
    await step('playback-' + variant, async () => {
      const armedRow = await select(variant);
      assert.equal(armedRow.bomb.armed, false, 'Selecting a playback only arms the timeline');
      assert.equal(armedRow.bomb.exploded, false);
      await page.getByRole('button', {name: 'Play replay', exact: true}).click();
      await frame.waitForFunction(variant => testScene.snapshot().variant === variant, variant);
      if (variant === 'safe-bomb') {
        await page.waitForTimeout(500);
        const safe = await frame.evaluate(() => testScene.snapshot());
        assert.equal(safe.bomb.enabled, false);
        assert.equal(safe.bomb.armed, false);
        assert.equal(safe.bomb.exploded, false);
        assert.ok(safe.enemies.every(enemy => enemy.enabled && enemy.health > 0));
      } else {
        await frame.waitForFunction(() => testScene.snapshot().bomb.exploded);
        const exploded = await frame.evaluate(() => testScene.snapshot());
        if (variant === 'one-enemy') {
          assert.ok(exploded.enemies[0].health <= 0);
          assert.equal(exploded.enemies[1].enabled, false);
          assert.ok(exploded.enemies[1].health > 0, 'Disabled enemy remains independent and undamaged');
        } else assert.ok(exploded.enemies.every(enemy => enemy.health <= 0),
          'The parent connects the bomb blast to both enemy instances');
      }
      const after = await frame.evaluate(() => testScene.snapshot());
      await shot('composition-' + variant);
      const restored = await reset();
      assert.equal(restored.variant, 'standard', 'Reset restores the starting render');
      assert.equal(restored.bomb.armed, false);
      assert.equal(restored.bomb.exploded, false);
      assert.ok(restored.enemies.every(enemy => enemy.enabled && enemy.health > 0));
      return {after, reset: true};
    });
  }

  await step('freePlay', async () => {
    await select('free-play');
    await page.getByRole('button', {name: 'Play replay', exact: true}).click();
    await page.waitForTimeout(150);
    assert.equal(await frame.evaluate(() => testScene.snapshot().bomb.armed), false);
    await page.getByRole('button', {name: 'io_lock', exact: true}).click();
    await frame.waitForFunction(() => testScene.snapshot().io);
    await page.keyboard.press('e');
    await frame.waitForFunction(() => testScene.snapshot().bomb.armed);
    await page.keyboard.press('Escape');
    await frame.waitForFunction(() => !testScene.snapshot().io);
    assert.equal(await frame.evaluate(() => testScene.snapshot().bomb.armed), true,
      'First Escape releases input without cancelling playback');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[aria-label="Play replay"]')?.disabled === true);
    await ready();
    assert.equal(await frame.evaluate(() => testScene.snapshot().bomb.armed), false);
    return {manualArm: true, twoStageEscape: true};
  });

  await step('towerAssault', async () => {
    const selected = await select('tower-assault');
    assert.equal(selected.tower.active, false, 'Selecting the scenario does not start the throw cycle');
    assert.equal(selected.guards.length, 2, 'Two additional bots occupy the tower');
    assert.ok(selected.guards.every(guard => guard.enabled && guard.position[1] > 10));
    assert.ok(selected.tower.height >= 18, 'The tower is substantially taller than the ground bots');
    assert.equal(Array.isArray(selected.tower.sockets) ? selected.tower.sockets.length : selected.tower.sockets, 2);
    const baseline = await frame.evaluate(() => ({meshes: testScene.scene.meshes.length,
      materials: testScene.scene.materials.length}));
    await page.getByRole('button', {name: 'Play replay', exact: true}).click();
    await frame.waitForFunction(() => testScene.snapshot().robots.some(robot => !robot.landed && robot.position[1] > 10));
    const launched = await frame.evaluate(() => testScene.snapshot().robots.find(robot => !robot.landed && robot.position[1] > 10));
    assert.ok(launched.id, 'Thrown robots retain independent identities');
    await frame.waitForFunction(({id, position}) => {
      const robot = testScene.snapshot().robots.find(robot => robot.id === id);
      return robot && Math.hypot(...robot.position.map((value, index) => value - position[index])) > .25;
    }, launched);
    await frame.waitForFunction(id => testScene.snapshot().robots.some(robot => robot.id === id && robot.landed), launched.id);
    const landed = await frame.evaluate(id => testScene.snapshot().robots.find(robot => robot.id === id), launched.id);
    assert.ok(landed.position[1] < 2, 'The thrown robot reaches the arena floor');
    const beforeOverview = await frame.evaluate(() => testScene.snapshot());
    assert.ok(beforeOverview.tower.throws > 0);
    await frame.evaluate(() => testScene.overview());
    await rendered(frame);
    const pixels = await visiblePixels();
    assert.ok(pixels.colors > 300, 'The overview frames the tower and arena, not just a sliver of geometry');
    await shot('tower-overview');

    const bounded = await frame.evaluate(() => {
      // Advance the actual scheduler without waiting a minute of wall time.
      for (let tick = 0; tick < 1200; tick++) testScene.nodes.tower.update(.05);
      return testScene.snapshot();
    });
    assert.ok(bounded.tower.throws >= 10, 'Repeated volleys actually run');
    assert.ok(bounded.robots.length <= 8, 'The scene bounds live robot instances');

    const disabled = await frame.evaluate(() => {
      testScene.stopAssault();
      testScene.nodes.guards.forEach(guard => { guard.enabled = false; });
      testScene.startAssault();
      for (let tick = 0; tick < 160; tick++) testScene.nodes.tower.update(.05);
      const guards = testScene.snapshot();
      testScene.stopAssault();
      testScene.nodes.tower.enabled = false;
      testScene.startAssault();
      for (let tick = 0; tick < 160; tick++) testScene.nodes.tower.update(.05);
      const tower = testScene.snapshot();
      return {guards: guards.robots.length, tower: tower.robots.length};
    });
    assert.deepEqual(disabled, {guards: 0, tower: 0}, 'Disabled guard and tower nodes cannot spawn robots');
    const restored = await reset();
    assert.equal(restored.tower.active, false);
    assert.equal(restored.tower.enabled, true);
    assert.equal(restored.robots.length, 0);
    assert.ok(restored.guards.every(guard => guard.enabled && guard.health > 0));
    assert.deepEqual(await frame.evaluate(() => ({meshes: testScene.scene.meshes.length,
      materials: testScene.scene.materials.length})), baseline, 'Reset disposes spawned robots and their materials');
    return {guards: selected.guards.map(guard => guard.position), launched, landed,
      volleys: bounded.tower.throws, retainedRobots: bounded.robots.length, disabled, reset: true, pixels};
  });

  await step('openableChildren', async () => {
    const children = [];
    for (const child of ['bomb.i3d', 'enemy.i3d', 'player.i3d', 'tower.i3d', 'robot.i3d']) {
      const path = node + '/' + child;
      const previous = await source();
      await page.evaluate(path => __alembic.open(path), path);
      await page.waitForFunction(path => __alembic.state().file.startsWith(path + '/'), path);
      const childFrame = await renderFrame(page, previous);
      await childFrame.locator('canvas').waitFor();
      await page.waitForFunction(() => !!__alembic.pose());
      assert.equal(await page.locator('.viewport iframe').evaluate(element => getComputedStyle(element).visibility), 'visible');
      await rendered(childFrame);
      const pixels = await visiblePixels();
      children.push({child, pixels});
    }
    await page.evaluate(path => __alembic.open(path), node);
    await ready();
    return children;
  });
}
