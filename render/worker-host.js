let worker, port;
addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'alembic.runtime' || port)
        return;
    const source = new URL(event.data.worker);
    if (source.origin !== location.origin || !source.pathname.startsWith(new URL('.', location.href).pathname))
        return;
    port = event.ports[0];
    worker = new Worker(source.href, { type: 'module' });
    worker.onmessage = ({ data }) => port.postMessage(data);
    worker.onerror = event => port.postMessage({ fatal: event.message });
    port.onmessage = ({ data }) => worker.postMessage({ ...data, base: new URL('../', source).href });
    port.postMessage({ ready: true });
});
addEventListener('pagehide', () => {
    worker?.terminate();
    port?.close();
});
