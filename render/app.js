// Arbitrary apps bind the existing bridge; app-tools.js supplies DOM and canvas capture.
import { bindInteraction } from '/assets/play/interaction.js';
const config = window.__alApp || { renders: ['app'], scenarios: [] }, origin = location.origin;
let layer, shapes = [], state = config.state || '', start = performance.now(), camera = {
    width: 400, height: 240, region: [0, 0, 400, 240], distance: 4, windowY: 1, orthographic: true, world: [1, 0, 0, 0,
      0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 4, 1], view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -4, 1], clip: [1, 0, 0, 0,
      0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
};
const send = body => parent.postMessage(body, origin);
addEventListener('error', e => send({ type: 'alembic.web.failure', error: e.message }));
addEventListener('unhandledrejection', e => send({ type: 'alembic.web.failure', error: String(e.reason?.message ||
  e.reason) }));
// Light iframe handshake: the parent iframe owns input gating, not the authored page.
const lightIframe = !config.threeD;
const io = on => {
    if (lightIframe) return;
    layer?.remove();
    layer = null;
    if (!on) {
        layer = document.createElement('div');
        Object.assign(layer.style, { position: 'fixed', inset: 0, zIndex: 2147483647 });
        layer.dataset.alembicOverlay = '';
        document.body.append(layer);
    }
};
const binding = bindInteraction({io_lock: io, release() {}});
await binding.ready;
window.__alEmbedded = {
    binding, get state() {
        return state;
    }, get camera() {
        return camera;
    }, get time() {
        return (performance.now() - start) / 1000;
    }
};
const reply = (data, result) => send({ type: 'alembic.web.result', id: data.id, ok: true, result });
addEventListener('message', async (event) => {
    const data = event.data;
    if (event.source !== parent || event.origin !== origin || !data?.type?.startsWith('alembic.'))
        return;
    try {
        if (data.type === 'alembic.web.draw' && config.mock)
            shapes = data.shapes;
        else if (data.type === 'alembic.web.play') {
            if (config.mock) {
                const next = JSON.parse(data.script);
                const response = await fetch('/__al/state', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next)
                });
                if (!response.ok)
                    throw Error('State peer failed');
                const peer = await response.json();
                if (peer.mode === 'failed')
                    throw Error('Recorded render peer failure');
                if (['slow', 'pending'].includes(peer.mode))
                    await new Promise(resolve => setTimeout(resolve, peer.mode === 'slow' ? 2500 : 1000));
                state = next.state;
                start = performance.now();
                document.body.dataset.state = state;
            }
            else if (data.script)
                throw Error('This app has no authored playback binding');
            reply(data, { state });
        }
        else if (data.type === 'alembic.web.reset') {
            state = config.state || 'iframe-success';
            if (config.mock)
                await fetch('/__al/state', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state })
                });
            start = performance.now();
            shapes = [];
            document.body.dataset.state = state;
            reply(data, { state });
        }
        else if (data.type === 'alembic.web.render') {
            if (!config.mock)
                throw Error('This app has no spatial renderer');
            if (['camera', 'setCamera'].includes(data.operation)) {
                camera = { ...camera, ...data.camera };
                send({ type: 'alembic.web.camera', camera });
            }
            else if (['viewport', 'setViewport'].includes(data.operation)) {
                camera.width = data.width || 400;
                camera.height = data.height || 240;
                camera.region = [0, 0, camera.width, camera.height];
            }
            const objects = [{ id: 'mock-canvas', name: 'Recorded mock object' }];
            if (data.operation === 'capture')
                reply(data, Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0)));
            else if (data.operation === 'pick')
                reply(data, { point: [0, 0, 0], objects, camera });
            else if (data.operation === 'objects')
                reply(data, { objects, camera, context: { state, time: (performance.now() - start) / 1000 } });
            else if (['state', 'camera', 'setCamera', 'viewport', 'setViewport'].includes(data.operation))
                reply(data, camera);
            else
                throw Error('Unknown mock render operation');
        }
    }
    catch (error) {
        send({ type: 'alembic.web.result', id: data.id, ok: false, error: error.message });
    }
});
addEventListener('keydown', event => {
    if (event.key === 'Escape' && binding.state.io_lock)
        send({ type: 'alembic.web.interaction.key', key: 'Escape' });
}, true);
if (config.mock && config.threeD) {
    addEventListener('pointermove', e => {
        if (e.buttons) {
            camera.world[12] += e.movementX * .01;
            send({ type: 'alembic.web.camera', camera });
        }
    });
    addEventListener('wheel', e => {
        camera.world[14] += e.deltaY * .001;
        send({ type: 'alembic.web.camera', camera });
    });
}
const canvas = config.mock && document.querySelector('canvas');
if (canvas) {
    const ctx = canvas.getContext('2d');
    setInterval(() => {
        ctx.fillStyle = '#243649';
        ctx.fillRect(0, 0, 400, 240);
        ctx.fillStyle = '#eb9b70';
        ctx.fillRect(20 + Math.floor((performance.now() - start) / 100) % 240, 60, 40, 40);
        for (const shape of shapes) {
            ctx.strokeStyle = '#e28a67';
            ctx.strokeRect(180 + (shape.center?.[0] || 0) * 30, 100, 40, 40);
        }
    }, 50);
}
if (config.mode === 'failed')
    send({ type: 'alembic.web.failure', error: 'Recorded render peer failure' });
if (['pending', 'slow'].includes(config.mode))
    await new Promise(resolve => setTimeout(resolve, config.mode === 'pending' ? 1000 : 2500));
const announce = () => send({
    type: 'alembic.web.ready', renders: config.renders, scenarios: config.scenarios, exports: [], controls: [
        'play', 'reset', 'escape', 'io_lock', ...(config.threeD ? ['orbit', 'pan', 'zoom'] : [])
    ], interaction: binding.state, seek: [], ...(config.mock ? {
        renderer: {
            camera, gpu: {
                vendor: 'mock', device: 'mock', description: 'Deterministic test peer', software: false
            }
        }
    } : {})
});
// A frame load can race its parent's listener or a bridge reload. Readiness is
// repeatable; the host still validates every advertised capability.
addEventListener('message', event => {
    if (event.source === parent && event.origin === origin && event.data?.type === 'alembic.web.connect')
        announce();
});
announce();
