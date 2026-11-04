const registrations = new Map();
// A preview server has no controller API or credentials. Keep its origin distinct
// even when both services happen to run on loopback.
export function previewOrigin(value, controller = location.origin) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.origin === controller || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Invalid preview origin');
  return url.origin;
}
export async function discoverPreview(config, manifest, controller = location.origin) {
  if (config.preview) return previewOrigin(config.preview, controller);
  const response = await fetch(manifest, {cache: 'no-store'});
  if (!response.ok) return '';
  const data = await response.json();
  return data.controller === controller && data.workspaces?.[config.workspace]
    ? previewOrigin(data.workspaces[config.workspace], controller) : '';
}
export function preparePreview(url) {
  if (!registrations.has(url)) {
    const promise = (async () => {
      if (!navigator.serviceWorker) throw new Error('Preview unavailable');
      const registration = await navigator.serviceWorker.register(url);
      if (registration.active) return;
      const worker = registration.installing || registration.waiting;
      if (!worker) throw new Error('Preview unavailable');
      await new Promise((resolve, reject) => {
        const finish = error => { clearTimeout(timer); worker.removeEventListener('statechange', change); error ? reject(error) : resolve(); };
        const change = () => { if (worker.state === 'activated') finish(); else if (worker.state === 'redundant') finish(new Error('Preview unavailable')); };
        const timer = setTimeout(() => finish(new Error('Preview timed out')), 10000);
        worker.addEventListener('statechange', change); change();
      });
    })();
    registrations.set(url, promise);
    promise.catch(() => registrations.delete(url));
  }
  return registrations.get(url);
}
// A trusted frame runs the vendored worker under its own CSP. File data stays JSON.
export function runtimeExecutor(worker, serviceWorker) {
  let frame, port, ready, abortReady, failure, closed = false, serial = 0;
  const pending = new Map();
  const rejectAll = error => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error); } pending.clear(); };
  function initialize() {
    return ready ??= (async () => {
      await preparePreview(serviceWorker);
      if (closed) throw new Error('Closed');
      const source = new URL('runtimes/worker-host.html', serviceWorker), channel = new MessageChannel();
      port = channel.port1;
      const initialized = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Runtime timed out')), 10000);
        abortReady = () => { clearTimeout(timer); reject(new Error('Closed')); };
        port.onmessage = ({data}) => {
          if (data.fatal) { failure = new Error(data.fatal); clearTimeout(timer); rejectAll(failure); reject(failure); return; }
          if (data.ready) { clearTimeout(timer); resolve(); return; }
          const task = pending.get(data.id);
          if (!task) return;
          pending.delete(data.id); clearTimeout(task.timer);
          data.error ? task.reject(new Error(data.error)) : task.resolve(data.value);
        };
      });
      frame = Object.assign(document.createElement('iframe'), {src: source.href, title: 'Runtime worker', hidden: true});
      frame.onload = () => { frame.onload = null; if (!closed) frame.contentWindow.postMessage({type: 'alembic.runtime', worker}, source.origin, [channel.port2]); };
      document.body.append(frame);
      await initialized;
      if (closed) throw new Error('Closed');
    })();
  }
  const execute = async request => {
    if (closed) throw new Error('Closed');
    await initialize();
    if (failure) throw failure;
    if (closed) throw new Error('Closed');
    return new Promise((resolve, reject) => {
      const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('Runtime timed out')); }, 30000);
      pending.set(id, {resolve, reject, timer}); port.postMessage({id, request});
    });
  };
  execute.close = () => { closed = true; abortReady?.(); rejectAll(new Error('Closed')); port?.close(); frame?.remove(); };
  return execute;
}
