import {createRender, connectRender} from '../bridge.js';
import {bindInteraction} from '../../frontend/public/assets/play/interaction.js';
import {captureDOM} from '../../frontend/src/contract/dom-capture.js';

// Area handles belong to the host. The isolated document owns input, pixels and playback.
export async function bindRender({play, reset, io = () => {}, capture, renders = ['main'], scenarios = [],
  exports: declared = [], port = 'i2d'}) {
  if (typeof play !== 'function' ||
    typeof reset !== 'function') throw Error('Playback and reset bindings are required');
  let started = null, elapsed = 0;
  const binding = bindInteraction({io_lock: io, release() {}});
  await binding.ready;
  const time = async () => started === null ? elapsed : (performance.now() - started) / 1000;
  const surface = createRender({
    setIO: async state => io(state.io_lock),
    async play(scenario) { await play(scenario); elapsed = 0; started = performance.now(); },
    async reset() { await reset(); started = null; elapsed = 0; },
    ...(port === 'audio' ? {time} : {
      async setViewport() { dispatchEvent(new Event('resize')); },
      async drawShapes(shapes) {
        if (shapes.some(shape => shape.shape !== 'area')) throw Error('i2d accepts only area shapes');
        dispatchEvent(new MessageEvent('message', {source: parent, data: {type: 'alembic.areas', areas: shapes}}));
      },
      capture: capture || (async area => (await captureDOM(area || [0, 0, 1, 1])).png)
    })
  }, port);
  const disconnect = connectRender(surface, {});
  const timer = setInterval(async () => { if (started !== null) surface.emit('time', await time()); }, 50);
  const announce = () => surface.emit('ready', {renders, scenarios, exports: declared,
    controls: ['play', 'reset', 'escape'], interaction: binding.state});
  const receive = event => {
    if (event.source === parent && event.origin === location.origin &&
      event.data?.type === 'alembic.web.connect') announce();
  };
  addEventListener('message', receive);
  announce();
  return Object.assign(surface, {binding, dispose() {
    clearInterval(timer); disconnect(); removeEventListener('message', receive); return binding.dispose();
  }});
}
