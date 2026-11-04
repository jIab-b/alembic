import {createRender} from '../../../render/bridge.js';
export function createStub(port) {
  let now = 0, io = false;
  const operations = {
    async setIO(value) { io = value.io_lock; return {io_lock: io}; },
    async play() { now = 1; surface.emit('time', now); },
    async reset() { now = 0; surface.emit('time', now); }
  };
  if (port === 'audio') operations.time = async () => now;
  else Object.assign(operations, {
    async setViewport() {}, async drawShapes() {}, async capture() { return new Uint8Array([137,80,78,71]); }
  });
  if (port === 'i3d') Object.assign(operations, {
    async setCamera(value) {surface.emit('camera', value);}, async pick() {return {point: [0,0,0]};},
    async objects() {return {objects: []};}
  });
  const surface = createRender(operations, port);
  return surface;
}
export const broken = port => {const surface = createStub(port); delete surface.reset; return surface;};
