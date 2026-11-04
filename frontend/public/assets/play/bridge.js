
  // The static bridge serves node-backed files to an app with an opaque origin.
  // preview-sw.js serves app/<session>/<path> by asking this page, which asks Alembic (#host) for the file;
  // alembic.* messages (pick out, highlight in) pass between the app and Alembic unchanged. alembic.ready makes
  // Alembic resend its state: sent here when the app loads and again after the app's first message (an app
  // that talks is listening), and apps may send it themselves.
  // Fragments stay on the client. Accept old query links as well during rolling deployments.
  const query = new URLSearchParams(location.hash.slice(1) || location.search.slice(1)), host = query.get('host'), session = query.get('session');
  const entry = query.get('entry') || 'index.html', waiting = new Map();
  const lightIframe = query.get('handshake') === 'light-iframe';
  let serial = 0, app, fresh = true;
  navigator.serviceWorker.addEventListener('message', ({data, ports}) => {
    // Firefox's service-worker Client.url can omit a navigation fragment. Identify this bridge by message.
    if (data.type === 'alembic.session') { ports[0].postMessage({session,lightIframe,entry}); return; }
    const id = ++serial;
    waiting.set(id, ports[0]);
    parent.postMessage({type: 'alembic.read', id, path: data.path}, host);
  });
  addEventListener('message', ({data, origin, source}) => {
    if (!String(data?.type).startsWith('alembic.')) return;
    // Sender window first: in local dev Alembic and this page share an origin.
    if (source === app?.contentWindow) {
      if (lightIframe && data.type === 'alembic.iframe.key' && ['F3','Escape'].includes(data.key)) {parent.postMessage({...data,session},host);return;}
      if (data.type === 'alembic.inspected') { waiting.get(data.id)?.postMessage(data); waiting.delete(data.id); return; }
      if (['alembic.web.ready','alembic.web.result','alembic.web.inspect','alembic.web.interaction.result','alembic.web.interaction.key','alembic.web.camera','alembic.web.time','alembic.web.menu','alembic.web.place','alembic.web.failure'].includes(data.type)) {
        if (origin === location.origin && session &&
          (data.type !== 'alembic.web.interaction.key' || ['F3','Escape'].includes(data.key)))
          parent.postMessage({...data, session}, host);
        return;
      }
      if (!['alembic.pick', 'alembic.ready', 'alembic.dismiss', 'alembic.area-menu'].includes(data.type)) return;
      parent.postMessage(data, host);
      if (fresh) { fresh = false; parent.postMessage({type: 'alembic.ready'}, host); }
    }
    else if (source !== parent || origin !== host) return;
    else if (data.type === 'alembic.file') { waiting.get(data.id)?.postMessage(data); waiting.delete(data.id); }
    else if (['alembic.web.connect','alembic.web.play','alembic.web.reset','alembic.web.configure','alembic.web.interaction','alembic.web.render','alembic.web.draw'].includes(data.type)) {
      if (data.session === session) {
        if(data.type==='alembic.web.interaction'&&data.io_lock)app?.contentWindow.focus();
        app?.contentWindow.postMessage(data, location.origin);
      }
    }
    else if (lightIframe && data.type === 'alembic.iframe.focus' && data.session === session) app?.contentWindow.focus();
    else if (data.type === 'alembic.areas') app?.contentWindow.postMessage(data, '*');
    else if (data.type === 'alembic.area') under(data.area).then(found =>
      parent.postMessage({...found, type: 'alembic.under', id: data.id}, host, found.png ? [found.png] : []));
    else app?.contentWindow.postMessage(data, '*');
  });
  function under(area) {
    const id = ++serial;
    return new Promise(resolve => {
      const timer = setTimeout(() => { waiting.delete(id); resolve({objects: [], png: null, warning: 'Selection screenshot timed out; metadata retained'}); }, 11000);
      waiting.set(id, {postMessage(data) { clearTimeout(timer); resolve(data); }});
      app?.contentWindow.postMessage({type: 'alembic.inspect', id, area}, '*');
    });
  }
  // Cross-origin previews register here: the controller cannot register a worker
  // on the isolated server. This server's network headers allow the trusted bridge
  // to load even when Firefox's hard reload bypasses service-worker interception.
  const separate = new URL(host).origin !== location.origin;
  if (separate) {
    const worker = new URL('../preview-sw.js', location.href);
    worker.searchParams.set('host', host);
    const registration = await navigator.serviceWorker.register(worker.href);
    const pending = registration.installing || registration.waiting;
    if (pending && pending.state !== 'activated') await new Promise((resolve, reject) => {
      const done = error => { clearTimeout(timer); pending.removeEventListener('statechange', change); error ? reject(error) : resolve(); };
      const change = () => {
        if (pending.state === 'activated') done();
        else if (pending.state === 'redundant') done(new Error('Preview unavailable'));
      };
      const timer = setTimeout(() => done(new Error('Preview timed out')), 10000);
      pending.addEventListener('statechange', change); change();
    });
  }
  const registration = await navigator.serviceWorker.ready;
  // A hard reload can bypass the worker even when its registration is already active.
  // Reclaim this bridge before creating the app's navigation.
  const reclaim = () => new Promise(resolve => {
    const channel = new MessageChannel();
    const done = () => { clearTimeout(timer); channel.port1.close(); navigator.serviceWorker.removeEventListener('controllerchange', done); resolve(); };
    const timer = setTimeout(done, 3000);
    channel.port1.onmessage = done;
    navigator.serviceWorker.addEventListener('controllerchange', done);
    registration.active.postMessage({type: 'alembic.claim'}, [channel.port2]);
  });
  if (!navigator.serviceWorker.controller) await reclaim();
  const entryURL = new URL(`app/${session}/${entry}`, location.href);
  let recoveries = 0;
  function mount() {
  app?.remove();
  app = Object.assign(document.createElement('iframe'), {title: entry, src: 'about:blank',
    onload: () => {
      // A newly inserted frame inherits Firefox's hard-reload bypass flag. Make
      // its first real navigation from an already loaded about:blank document.
      app.onload = async () => {
        // A browser reload can bypass the worker and hit the API-free server,
        // which has no app/<session> files. Reclaim and navigate from blank again.
        let bypassed = false;
        try {
          const doc = app.contentDocument;
          bypassed = lightIframe && app.contentWindow.location.pathname === entryURL.pathname &&
            doc?.contentType === 'application/json' && doc.body?.textContent.includes('Not found');
        } catch { /* An opaque authored page cannot be inspected by the bridge. */ }
        if (bypassed) {
          if (recoveries++ < 2) { await reclaim(); mount(); return; }
          parent.postMessage({type:'alembic.web.failure',session,
            error:`Cannot load app file ${entry}: preview session could not recover after reload`},host);
          return;
        }
        if (lightIframe) app.contentWindow.postMessage({type:'alembic.iframe.mode'},'*');
        fresh = !lightIframe; parent.postMessage({type: 'alembic.ready'}, host);
      };
      app.contentWindow.location.replace(entryURL.href);
    }});
  document.body.append(app);
  }
  mount();
