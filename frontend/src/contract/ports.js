// Runtime requirements are owned by the frontend. Adapters may implement additional methods.
const events = ['onReady', 'onPlayback', 'onFailure'];
const playback = ['setIO', 'play', 'reset', ...events];
export const ports = Object.freeze({
  i3d: [...playback, 'setViewport', 'setCamera', 'drawShapes', 'pick', 'objects', 'capture', 'onCamera'],
  i2d: [...playback, 'setViewport', 'drawShapes', 'capture'],
  audio: [...playback, 'time']
});
export function assertPort(port, surface) {
  if (!ports[port]) throw Error('Unknown render port: ' + port);
  const missing = ports[port].filter(name => typeof surface?.[name] !== 'function');
  if (missing.length) throw Error(`${port} render contract missing: ${missing.join(', ')}`);
  return surface;
}
export function assertRemotePort(port, methods) {
  return assertPort(port, Object.fromEntries((Array.isArray(methods) ? methods : [])
    .map(name => [name, () => {}])));
}
