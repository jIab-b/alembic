import { NativeCamera } from '../native-camera.js';
// The frontend only sees the same camera mirror and request boundary as native views.
export const shapeStyle = { color: '#e28a67', alpha: .18 };
export function webSurface(call, send, bounds, source, state) {
    const camera = new NativeCamera(body => call('alembic.web.render', body), bounds, area => call('alembic.web.render',
      { operation: 'capture', area }), source);
    camera.update(state);
    camera.drawShapes = (shapes, style = shapeStyle, tool) => send({ type: 'alembic.web.draw', shapes, style, tool });
    return camera;
}
export { loadViewer } from '../../../render/registry.js';
export { mediaEntry } from './media.js';
export { checkedHTML } from './effect.js';
export { surfaceFor } from './types.js';
