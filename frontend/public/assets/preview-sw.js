// Serves app/<session>/<path> from the user's folder: asks the bridge page (index.html#session=...)
// that owns the session, which relays to Alembic. Nothing is cached; every request reads the folder.
// Only the matching bridge can answer a session. Same-origin controller previews
// stay opaque; only a dedicated, credential-free preview server keeps app origins.
const bundled = new Set(/* bundled assets */ []);
const host = new URL(self.location.href).searchParams.get('host');
const isolated = host && (() => {
  try { const url = new URL(host); return ['http:', 'https:'].includes(url.protocol) && url.origin === host && url.origin !== self.location.origin; }
  catch { return false; }
})();
const TYPES = {html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', txt: 'text/plain', wav: 'audio/wav', ogg: 'audio/ogg', mp3: 'audio/mpeg'};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type === 'alembic.claim') event.waitUntil(self.clients.claim().then(() => event.ports[0]?.postMessage(true)));
});
self.addEventListener('fetch', event => {
  const scope = new URL(self.registration.scope), url = new URL(event.request.url);
  if (url.origin !== scope.origin) return;
  const relative = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : '';
  // The server serves static assets with frame-ancestors 'none'. These packaged viewers
  // are trusted, same-origin frames; their authored child apps remain sandboxed below.
  if (relative === 'play/index.html' || relative.startsWith('runtimes/')) {
    event.respondWith((async () => {
      const response = await fetch(event.request), headers = new Headers(response.headers);
      const policy = headers.get('Content-Security-Policy');
      if (policy) headers.set('Content-Security-Policy', policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'").replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"));
      return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
    })());
    return;
  }
  // Plumbing belongs to the preview host, not to the app's asset root.
  if (['play/bridge.js','play/app-tools.js','play/dom-capture.js','play/interaction.js',
       'play/media.js','play/renderer.js','play/html.js','preview-sw.js'].includes(relative) ||
         bundled.has(relative) || url.pathname.startsWith('/__al/')) return;
  const match = /^play\/app\/([^/]+)\/(.+)$/.exec(relative);
  if (!match && !event.clientId) return;
  event.respondWith((async () => {
    let session, raw, rootAsset = !match;
    if (match) [, session, raw] = match;
    else {
      // Root-relative URLs belong to the requesting app, not Alembic's assets.
      const client = await self.clients.get(event.clientId);
      const source = client && new URL(client.url);
      const owner = source?.origin === scope.origin &&
        source.pathname.startsWith(scope.pathname) && /^play\/app\/([^/]+)\//.exec(source.pathname.slice(scope.pathname.length));
      if (!owner) return fetch(event.request);
      session = owner[1]; raw = url.pathname.slice(1);
    }
    const candidates = (await self.clients.matchAll({type: 'window', includeUncontrolled: true})).filter(client => {
      const path = new URL(client.url).pathname;
      return path === scope.pathname + 'play/index.html';
    });
    // Ask the bridge rather than depending on Client.url retaining its fragment (Firefox drops it on reload).
    const bridge = await Promise.any(candidates.map(client => new Promise((resolve, reject) => {
      const probe = new MessageChannel(), timer = setTimeout(() => { probe.port1.close(); reject(new Error('Bridge unavailable')); }, 3000);
      probe.port1.onmessage = ({data}) => {
        clearTimeout(timer); probe.port1.close();
        if (data.session === session) resolve({client, lightIframe:data.lightIframe,entry:data.entry}); else reject(new Error('Another session'));
      };
      client.postMessage({type: 'alembic.session'}, [probe.port2]);
    }))).catch(() => null);
    if (!bridge) return new Response('No Alembic session', {status: 404});
    if (rootAsset && !bridge.lightIframe) return fetch(event.request);
    if (rootAsset && !raw) raw=bridge.entry || 'index.html';
    let path;
    try { path = decodeURIComponent(raw); } catch { return new Response('Malformed path', {status: 400}); }
    if (path.split('/').some(part => !part || part.startsWith('.') || part.includes('\\')))
      return new Response('Invalid path', {status: 400});
    // Redirect preserves the app namespace for module imports, CSS URLs and workers.
    if (rootAsset)
      return Response.redirect(new URL(scope.pathname + 'play/app/' + session + '/' + raw + url.search, scope.origin).href);
    const channel = new MessageChannel();
    const reply = new Promise(resolve => {
      const timer = setTimeout(() => { channel.port1.close(); resolve({error: 'Preview timed out'}); }, 130000);
      channel.port1.onmessage = ({data}) => { clearTimeout(timer); channel.port1.close(); resolve(data); };
    });
    bridge.client.postMessage({path}, [channel.port2]);
    const {bytes, error} = await reply;
    if (!bytes) return new Response(`Cannot load app file ${path}: ${error || 'Not found'}`, {status: 404});
    const headers = {'Content-Type': TYPES[path.split('.').pop().toLowerCase()] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*'};
    let body = bytes;
    if (path.endsWith('.html')) {
      headers['Content-Security-Policy'] = 'sandbox allow-scripts allow-forms allow-pointer-lock' + (isolated ? ' allow-same-origin' : '');
      const tools = `<script src="${new URL('play/app-tools.js', self.registration.scope).href}"></script>`;
      const html = new TextDecoder().decode(bytes);
      body = /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, head => head + tools) : tools + html;
    }
    return new Response(body, {headers});
  })());
});
