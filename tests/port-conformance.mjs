import assert from 'node:assert/strict';
import {assertPort, assertRemotePort} from '../frontend/src/contract/ports.js';
export async function conform(port, surface) {
  assertPort(port, surface);
  assertRemotePort(port, surface.methods);
  for (const [event, name] of [['ready', 'onReady'], ['time', 'onPlayback'], ['failure', 'onFailure'],
    ...(port === 'i3d' ? [['camera', 'onCamera']] : [])]) {
    let count = 0;
    const off = surface[name](() => count++);
    assert.equal(typeof off, 'function');
    surface.emit(event, {}); assert.equal(count, 1);
    off(); surface.emit(event, {}); assert.equal(count, 1);
  }
  await surface.setIO({io_lock: false});
  if (port !== 'audio') {
    await surface.setViewport({width: 400, height: 240, pixelRatio: 1});
    await surface.drawShapes([], {color: '#e28a67', alpha: .18});
    assert.ok((await surface.capture([0,0,1,1])).byteLength);
  }
  if (port === 'i3d') {
    await surface.setCamera({position: [0,0,4], target: [0,0,0]});
    assert.ok(await surface.pick([200,120]));
    assert.ok(await surface.objects({shape: 'sphere', center: [0,0,0], radius: 1}));
  }
  await surface.play({id: 'one', script: '{}', duration: 1});
  if (port === 'audio') assert.equal(await surface.time(), 1);
  await surface.reset();
  if (port === 'audio') assert.equal(await surface.time(), 0);
}
