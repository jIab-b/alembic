import {assertPort, ports} from '../frontend/src/contract/ports.js';
// This is the runtime implementation of the Render contract, shared by both engines.
export function createRender(operations, port = 'i3d') {
    const listeners = new Map();
    const listen = name => listener => {
        if (!listeners.has(name))
            listeners.set(name, new Set());
        listeners.get(name).add(listener);
        return () => listeners.get(name).delete(listener);
    };
    const surface = {
        ...operations,
        onReady: listen('ready'), onCamera: listen('camera'), onPlayback: listen('time'), onFailure: listen('failure')
    };
    assertPort(port, surface);
    return Object.assign(surface, {
        port, methods: ports[port],
        emit(name, value) {
            for (const listener of listeners.get(name) || [])
                listener(value);
        }
    });
}
export function connectRender(surface, info) {
    assertPort(surface.port, surface);
    globalThis.__alRender = surface;
    const send = data => parent.postMessage(data, location.origin);
    let selected;
    try {
        selected = new URLSearchParams(parent.location.hash.slice(1)).get('render');
    }
    catch {
    }
    const off = [
        surface.onReady(data => send({
            type: 'alembic.web.ready', ...info, ...data, methods: surface.methods,
            ...(selected ? { renders: [selected] } : {})
        })),
        surface.onCamera?.(camera => send({
            type: 'alembic.web.camera', camera, at: performance.timeOrigin + performance.now()
        })),
        surface.onPlayback(time => send({ type: 'alembic.web.time', time })),
        surface.onFailure(error => send({ type: 'alembic.web.failure', error: String(error.message || error) }))
    ];
    const receive = async (event) => {
        const d = event.data;
        if (event.source !== parent || event.origin !== location.origin)
            return;
        try {
            let result;
            if (d?.type === 'alembic.web.draw') {
                await surface.drawShapes(d.shapes, d.style, d.tool);
                return;
            }
            if (d?.type === 'alembic.web.play')
                result = await surface.play({ ...d, id: d.scenario });
            else if (d?.type === 'alembic.web.reset')
                result = await surface.reset();
            else if (d?.type === 'alembic.web.render') {
                const methods = {
                    viewport: 'setViewport', camera: 'setCamera', pick: 'pick', objects: 'objects', capture: 'capture'
                };
                const method = methods[d.operation];
                if (!method)
                    throw Error('Unsupported render operation');
                result = await surface[method](d.pose || d.point || d.selection || d.area || d);
            }
            else
                return;
            send({ type: 'alembic.web.result', id: d.id, ok: true, result });
        }
        catch (error) {
            send({
                type: 'alembic.web.result', id: d.id, ok: false, error: String(error.message || error)
            });
        }
    };
    addEventListener('message', receive);
    return () => {
        removeEventListener('message', receive);
        off.forEach(dispose => dispose?.());
    };
}
