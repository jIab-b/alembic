// Installed beside the exported entry. Reuse the frozen interaction protocol.
import { bindInteraction } from './interaction.js';
import { createRender, connectRender } from './render-bridge.js';
export function bindGodot(engine) {
    const send = data => parent.postMessage(data, location.origin), pending = new Map();
    let serial = 0;
    const boot = new Promise(resolve => globalThis.alembicGodotBoot = resolve);
    const call = async (body) => {
        await boot;
        return new Promise((resolve, reject) => {
            const id = 'godot-' + (++serial), timer = setTimeout(() => {
                pending.delete(id);
                reject(Error('Godot operation timed out'));
            }, 15000);
            pending.set(id, { resolve, reject, timer });
            globalThis.alembicGodotReceive(JSON.stringify({ ...body, id }));
        });
    };
    async function setIO(state) {
        if ('io_lock' in state)
            await call({ operation: 'io', on: state.io_lock });
        if (state.io_lock) {
            window.focus();
            document.querySelector('canvas').focus({ preventScroll: true });
        }
    }
    const binding = bindInteraction({
        io_lock: on => setIO({ io_lock: on }), release: () => call({ operation: 'release' })
    });
    // Chrome suspends rAF in the frontend's hidden, not-yet-configured iframe.
    const raf = globalThis.requestAnimationFrame.bind(globalThis), cancel = globalThis.cancelAnimationFrame.bind(
      globalThis);
    globalThis.requestAnimationFrame = fn => binding.state.configured || parent === window ? raf(fn) : -setTimeout((
      ) => fn(performance.now()), 16);
    globalThis.cancelAnimationFrame = id => id < 0 ? clearTimeout(-id) : cancel(id);
    const render = createRender({
        setViewport: rect => call({ operation: 'viewport', ...rect }), setCamera: pose => call({ operation: 'camera',
            pose }),
        setIO,
        drawShapes: async (shapes, style, tool) => {
            await boot;
            globalThis.alembicGodotReceive(JSON.stringify({ type: 'alembic.web.draw', shapes, style, tool }));
        },
        pick: point => call({ operation: 'pick', point }), objects: selection => call({ operation: 'objects',
            selection }),
        capture: area => call({ operation: 'capture', area }),
        play: scenario => call({ ...scenario, scenario: scenario.id, type: 'alembic.web.play' }), reset: () => call(
          { type: 'alembic.web.reset' })
    });
    connectRender(render, {});
    globalThis.alembicGodotSend = async (text) => {
        const data = JSON.parse(text);
        if (data.png)
            data.result = Uint8Array.from(atob(data.png), c => c.charCodeAt(0));
        if (data.type === 'alembic.web.result' && pending.has(data.id)) {
            const p = pending.get(data.id);
            pending.delete(data.id);
            clearTimeout(p.timer);
            data.ok ? p.resolve(data.result) : p.reject(Error(data.error));
            return;
        }
        if (data.type === 'alembic.web.ready') {
            await binding.ready;
            data.interaction = binding.state;
            data.renderer.gpu = globalThis.alembicGodotGPU;
            render.emit('ready', data);
        }
        else if (data.type === 'alembic.web.camera')
            render.emit('camera', data.camera);
        else if (data.type === 'alembic.web.time')
            render.emit('time', data.time);
        else if (data.type === 'alembic.web.failure')
            render.emit('failure', Error(data.error));
        else
            send(data);
    };
    // Block gameplay input before Godot's listeners while preserving the inspector input.
    const canvas = document.querySelector('canvas');
    for (const name of [
        'keydown', 'keyup', 'pointerdown', 'pointerup', 'pointermove', 'wheel', 'contextmenu', 'dblclick'
    ])
        addEventListener(name, event => {
            if (binding.state.io_lock)
                return;
            if (['F3', 'Escape'].includes(event.key))
                return;
            if (event.target !== canvas && !name.startsWith('key'))
                return;
            if (name === 'pointerdown')
                canvas.setPointerCapture(event.pointerId);
            globalThis.alembicGodotReceive(JSON.stringify({
                operation: 'inspect', event: name, code: event.code || '', x: event.clientX || 0, y: event.clientY || 0,
                dx: event.movementX || 0, dy: event.movementY || 0, button: event.button, buttons: event.buttons,
                shift: event.shiftKey, delta: event.deltaY || 0
            }));
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
    canvas.addEventListener('click', () => {
        if (binding.state.io_lock)
            canvas.requestPointerLock?.()?.catch(error => send({ type: 'alembic.web.failure', error: String(error) }));
    });
    return render;
}
export function requireGPU(canvas) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const description = ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (!description || /swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i.test(description))
        throw Error('Godot requires hardware WebGL2: ' + description);
    canvas.addEventListener('webglcontextlost', () => parent.postMessage({
        type: 'alembic.web.failure', error: 'Godot WebGL context lost'
    }, location.origin));
    return globalThis.alembicGodotGPU = { description, software: false };
}
// Keep each node-file request below Vault's 16 MiB transport boundary.
export function wasmParts(file, parts) {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, options) => {
        if (new URL(typeof input === 'string' ? input : input.url, location.href).pathname !== new URL(file,
          location.href).pathname)
            return original(input, options);
        const buffers = [];
        for (const part of parts) {
            const response = await original(part, options);
            if (!response.ok)
                throw Error('Missing Godot WASM part: ' + part);
            buffers.push(await response.arrayBuffer());
        }
        return new Response(new Blob(buffers), { headers: { 'Content-Type': 'application/wasm' } });
    };
}
