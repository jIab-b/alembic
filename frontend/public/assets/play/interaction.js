// Runtime hooks own IO and pointer capture. Retired hooks on old nodes are never invoked.
export function bindInteraction(hooks) {
  if (typeof hooks?.release !== 'function') throw Error('Interaction release hook is required');
  const capabilities = {io_lock: typeof hooks.io_lock === 'function'};
  const state = {io_lock: false, permissions: {io_lock: false}, capabilities, configured: false};
  let closed = false, queue = Promise.resolve(), hadPointerLock = false;
  const snapshot = () => ({...state, permissions: {...state.permissions}, capabilities: {...capabilities}});
  const reply = (id, error) => parent.postMessage({type: 'alembic.web.interaction.result', id, ok: !error,
    ...(error ? {error: String(error.message || error).slice(0, 200)} : {}), state: snapshot()}, location.origin);
  async function releaseAll() { let failure;
    const attempt = async fn => { try { await fn(); } catch (e) { failure ||= e; } };
    await attempt(async () => { if (capabilities.io_lock) { await hooks.io_lock(false); state.io_lock = false; } });
    await attempt(() => hooks.release());
    // Inspection drag locks belong to orbit, not IO.
    await attempt(() => { if (hadPointerLock && document.pointerLockElement) document.exitPointerLock(); });
    hadPointerLock = false; if (failure) throw failure; }
  const ready = releaseAll(), enqueue = action => {
    const pending = queue.then(() => ready).then(action); queue = pending.catch(() => {}); return pending; };
  async function receive({data, source, origin}) {
    if (closed || source !== parent || origin !== location.origin ||
        !['alembic.web.configure', 'alembic.web.interaction'].includes(data?.type)) return;
    if (typeof data.id !== 'string' || !data.id || data.id.length > 128) return;
    await enqueue(async () => { if (closed) throw Error('Interaction binding is closed');
      if (data.type === 'alembic.web.configure') { const grants = data.interaction;
        if (!grants || typeof grants !== 'object' || Array.isArray(grants) ||
            Object.entries(grants).some(([key, on]) => key !== 'io_lock' || typeof on !== 'boolean'))
          throw Error('Invalid interaction permissions');
        await releaseAll(); state.configured = true;
        state.permissions = {io_lock: Object.hasOwn(grants, 'io_lock') && grants.io_lock === true}; return; }
      if (Object.keys(data).some(key => !['type', 'id', 'session', 'io_lock'].includes(key)))
        throw Error('Invalid interaction command');
      const on = Object.hasOwn(data, 'io_lock') ? data.io_lock : state.io_lock;
      if (typeof on !== 'boolean') throw Error('Interaction flags must be booleans');
      if (on && (!state.configured || !state.permissions.io_lock || !capabilities.io_lock))
        throw Error('Interaction permission or binding unavailable: io_lock');
      try { await hooks.release();
        if (capabilities.io_lock && on !== state.io_lock) { await hooks.io_lock(on); state.io_lock = on; }
        if (!on && hadPointerLock && document.pointerLockElement) {
          hadPointerLock = false; document.exitPointerLock(); }
      } catch (error) { await releaseAll().catch(() => {}); throw error; }
    }).then(() => reply(data.id), error => reply(data.id, error)); }
  const release = () => { if (!closed) void enqueue(releaseAll).then(() => reply(null), e => reply(null, e)); };
  const forwardKey = key => parent.postMessage({type: 'alembic.web.interaction.key', key}, location.origin);
  const keydown = event => { if (event.key === 'F3') {
      event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat && !closed) forwardKey('F3');
    } else if (event.key === 'Escape') { if (state.io_lock) release(); else forwardKey('Escape'); } };
  const lock = () => { const locked = state.io_lock && !!document.pointerLockElement;
    if (hadPointerLock && !locked && state.io_lock) release(); hadPointerLock = locked; };
  const listeners = [[window, 'message', receive], [window, 'blur', release],
    [window, 'keydown', keydown, true], [document, 'pointerlockchange', lock]];
  for (const [node, ...args] of listeners) node.addEventListener(...args);
  return {ready, get state() { return snapshot(); }, async dispose() {
    closed=true;for(const [node,...args] of listeners) node.removeEventListener(...args); await enqueue(releaseAll); }};
}
