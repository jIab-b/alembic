import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {localRender} from '../render/local.js';
import { container, framed, pack, within } from '../frontend/src/gltf.js';

const examples = new URL('./mock/i3d/', import.meta.url);
// Two boxes: node 1 at the origin, node 2 four units along x.
const items = [{ node: 1, name: 'A', min: [-1, -1, -1], max: [1, 1, 1] }, { node: 2, name: 'B', min: [3, -1, -1], max: [5, 1, 1] }];

test('GLB and glTF give the same JSON, and pack reads back', async () => {
  const { json } = container(await readFile(new URL('animated.i3d/scene.gltf', examples)));
  const bin = Buffer.from(json.buffers[0].uri.split(',')[1], 'base64'), bare = { ...json, buffers: [{ byteLength: bin.length }] };
  const glb = container(pack(bare, bin));
  assert.deepEqual(glb.json, bare);
  assert.deepEqual(Buffer.from(glb.bin).subarray(0, bin.length), bin);
});

test('volumes hold the nodes whose bounds they touch; ovals stretch per axis', () => {
  assert.deepEqual(within(items, { shape: 'sphere', center: [0, 0, 0], radius: 1 }), [{ node: 1, name: 'A' }]);
  assert.deepEqual(within(items, { shape: 'box', center: [2, 0, 0], size: [2.2, 1, 1] }).map(o => o.node), [1, 2]);
  assert.deepEqual(within(items, { shape: 'sphere', center: [2, 0, 0], radius: 0.9 }), []);
  assert.deepEqual(within(items, { shape: 'sphere', center: [2, 0, 0], radius: 0.9, radii: [1.1, 0.9, 0.9] }).map(o => o.node), [1, 2]);
});

test('areas hold the nodes whose projected bounds overlap them', () => {
  const flat = ([x, y]) => [(x + 2) / 8, (y + 2) / 8];  // a straight-on view: x right, y down, from -2 to 6
  assert.deepEqual(framed(items, [0, 0, 0.3, 1], flat).map(o => o.node), [1]);
  assert.deepEqual(framed(items, [0.55, 0, 0.3, 1], flat).map(o => o.node), [2]);
  assert.deepEqual(framed(items, [0.4, 0, 0.1, 1], flat), []);
});

test('static GLB playback holds and resets; an explicit missing clip still fails', async () => {
  let resets=0,restores=0;
  const render=localRender({animations:()=>[],selectAnimation:()=>null},{},{pose:()=>({}),restore:()=>restores++});
  await render.configure({render:'main',scenarios:[],reset:async()=>resets++});
  await render.command('alembic.web.play',{scenario:'hold',script:'{}'});
  await render.command('alembic.web.reset',{});
  assert.equal(resets,1);assert.equal(restores,1);
  await assert.rejects(render.command('alembic.web.play',{scenario:'missing',script:'{"clip":0}'}),/declared animation clip/);
});
