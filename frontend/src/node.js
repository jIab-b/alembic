// Node API v1 + SPEC-replay. Saved connections are scoped to each project and frontend origin.
import {previewOrigin} from './preview.js';
export function connection(fragment) {
  const p = new URLSearchParams(fragment.replace(/^#/, ''));
  const token = p.get('token') || p.get('grant'), workspace = p.get('workspace'), vm = p.get('vm');
  if (!token || !workspace || !vm) throw new Error('Missing connection credentials');
  const base = new URL(p.get('node') || p.get('base') || location.origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid node URL');
  const agents = p.has('agents') ? agentNames(p.get('agents')) : undefined;
  const preview = p.has('preview') ? previewOrigin(p.get('preview'), base.origin) : '';
  return {base: base.href.replace(/\/$/, ''), token, workspace, vm, agents, ...(preview ? {preview} : {})};
}
const connectionKey = 'alembic-connection';
const profileKey = workspace => `${connectionKey}:${workspace}`;
function stored(browser, storage, key) { try { return browser[storage]?.getItem(key) || ''; } catch { return ''; } }
function serialized(config) {
  const {base, token, workspace, vm, agents, preview} = config;
  return new URLSearchParams({node: base, token, workspace, vm,
    ...(agents === undefined ? {} : {agents: agents.join(',')}), ...(preview ? {preview} : {})}).toString();
}
function saveConnection(config, browser) {
  const value = serialized(config);
  try { browser.sessionStorage.setItem(connectionKey, value); } catch {}
  try {
    browser.localStorage.setItem(profileKey(config.workspace), value);
    browser.localStorage.setItem(connectionKey + ':last', config.workspace);
    return true;
  } catch { return false; }
}
export function tabConnection(browser = globalThis) {
  const query = new URLSearchParams(browser.location.search), requested = query.get('workspace');
  let fragment = browser.location.hash;
  if (!fragment || fragment === '#') {
    const tab = stored(browser, 'sessionStorage', connectionKey);
    const workspace = requested || (tab && new URLSearchParams(tab).get('workspace')) || stored(browser, 'localStorage', connectionKey + ':last');
    fragment = tab && (!requested || new URLSearchParams(tab).get('workspace') === requested) ? tab : stored(browser, 'localStorage', profileKey(workspace));
  }
  const config = connection(fragment);
  if (saveConnection(config, browser)) try {
    query.set('workspace', config.workspace);
    browser.window.history.replaceState(null, '', browser.location.pathname + '?' + query);
  } catch {} // Retain the launch fragment if durable storage or history is unavailable.
  return config;
}
export function validateArgv(argv, empty = false) {
  if (!Array.isArray(argv) || (!empty && !argv.length) || argv.some(arg => typeof arg !== 'string' || arg.includes('\0')) || (argv.length && !argv[0]))
    throw new Error('Invalid command argv or executable');
  return argv;
}
export class NodeClient {
  constructor(config, transport = (...args) => globalThis.fetch(...args), sockets = url => new WebSocket(url), browser = globalThis) {
    this.config = {...config}; this.transport = transport; this.sockets = sockets; this.browser = browser;
    this.cache = new Map(); this.versions = new Map();
    this.pendingReads = new Map(); this.readRevision = 0;
    this.readiness={workspaceListed:false,vmVerified:false,rootTreeListed:false,error:''}; this.scope = new AbortController();
    this.reconnecting = null; this.vmUnverified = false;
    // Internal scheduling points let unit tests exercise gaps without waiting in real time.
    this.reconnectDelays = [0, 250, 500, 1000, 1500, 1500, 1500, 1500, 1500, 1500, 1500];
  }
  w(op, query = {}) { return `/w/${encodeURIComponent(this.config.workspace)}/${op}?${new URLSearchParams(query)}`; }
  v(op) { return `/vms/${encodeURIComponent(this.config.vm)}/${op}`; }
  async waitForVm(delay) {
    this.scope.signal.throwIfAborted();
    if (!delay) return;
    await new Promise((resolve, reject) => {
      const done = () => { this.scope.signal.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(done, delay);
      const abort = () => { clearTimeout(timer); this.scope.signal.removeEventListener('abort', abort); reject(this.scope.signal.reason); };
      this.scope.signal.addEventListener('abort', abort, {once: true});
    });
  }
  reconnectVm(missing) {
    this.scope.signal.throwIfAborted();
    if (this.config.vm !== missing) return Promise.resolve(true);
    if (this.reconnecting) return this.reconnecting;
    const pending = this.findReplacementVm(missing);
    this.reconnecting = pending.finally(() => { this.reconnecting = null; });
    return this.reconnecting;
  }
  async waitForRecovery(missing, signal) {
    signal.throwIfAborted();
    const pending = this.reconnectVm(missing);
    if (signal === this.scope.signal) return pending;
    // A cancelled caller need not wait for recovery shared with other live requests.
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
      signal.addEventListener('abort', abort, {once: true});
      pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
        error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  async findReplacementVm(missing) {
    const deadline = Date.now() + 15000;
    for (const delay of this.reconnectDelays) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await this.waitForVm(Math.min(delay, remaining));
      if (Date.now() >= deadline) break;
      let rows;
      try {
        const response = await this.request('/vms', {signal: AbortSignal.timeout(Math.max(1, deadline - Date.now()))}, false);
        rows = await response.json();
      } catch (error) {
        this.scope.signal.throwIfAborted();
        if (error.name === 'TimeoutError') break;
        throw error;
      }
      this.scope.signal.throwIfAborted();
      if (!Array.isArray(rows)) throw new Error('Unable to check the project Vault connection');
      // A missing session or ticket route on a live VM must keep its original error.
      const current = rows.find(row => row.id === missing);
      if (current) {
        if (current.workspace !== this.config.workspace) { this.vmUnverified = true; throw new Error('The saved Vault belongs to a different project. Reconnect using the intended project.'); }
        this.vmUnverified = false; this.readiness.vmVerified=true; return false;
      }
      const matches = rows.filter(row => row.workspace === this.config.workspace && typeof row.id === 'string');
      if (matches.length > 1) throw new Error('Several Vaults are running for this project. Use the launcher connection for the intended Vault.');
      if (!matches.length) continue;
      this.config.vm = matches[0].id; this.vmUnverified = false; this.readiness.vmVerified=true;
      saveConnection(this.config, this.browser);
      return true;
    }
    throw new Error('This project\'s Vault is stopped or unavailable. Resume it through the launcher, then reconnect this tab.');
  }
  async request(path, init = {}, recoverVm = true) {
    if (['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) return this.fetchRequest(path, init, recoverVm);
    this.invalidateReads();
    try { return await this.fetchRequest(path, init, recoverVm); }
    finally { this.invalidateReads(); }
  }
  async fetchRequest(path, init = {}, recoverVm = true) {
    const requestedVm = this.config.vm;
    const target = /^\/vms\/([^/?]+)(?=\/|\?|$)/.exec(path);
    if (recoverVm && this.vmUnverified && target && decodeURIComponent(target[1]) === requestedVm) {
      const replaced = await this.waitForRecovery(requestedVm, init.signal || this.scope.signal);
      if (replaced) {
        const method = (init.method || 'GET').toUpperCase();
        if (!['GET', 'HEAD'].includes(method)) throw new Error('The project Vault changed. Reconnect and submit this action again.');
        return this.request(path.replace(target[0], '/vms/' + encodeURIComponent(this.config.vm)), init, false);
      }
    }
    const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${this.config.token}`);
    const signal = init.signal ? AbortSignal.any([this.scope.signal, init.signal]) : this.scope.signal;
    signal.throwIfAborted();
    const response = await this.transport(this.config.base + path, {...init, headers, credentials: 'omit', cache: 'no-store', signal});
    signal.throwIfAborted();
    if (response.status === 404 && recoverVm) {
      const match = /^\/vms\/([^/?]+)(?=\/|\?|$)/.exec(path);
      if (match && decodeURIComponent(match[1]) === requestedVm && await this.waitForRecovery(requestedVm, signal)) {
        const method = (init.method || 'GET').toUpperCase();
        const ticket = /^\/(?:shell\/ticket|sessions\/[^/]+\/attach)$/.test(path.slice(match[0].length).split('?')[0]);
        if (!['GET', 'HEAD'].includes(method) && !ticket)
          throw new Error('The project Vault changed. Reconnect and submit this action again.');
        return this.request(path.replace(match[0], '/vms/' + encodeURIComponent(this.config.vm)), init, false);
      }
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(`${response.status} ${body.error || response.statusText}${body.fix ? ': ' + body.fix : ''}`);
      Object.assign(error, {status: response.status, code: body.error || '', retryable: body.retryable === true});
      throw error;
    }
    return response;
  }
  async json(path, body) {
    return (await this.request(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json();
  }
  invalidateReads() { this.readRevision++; this.pendingReads.clear(); }
  sharedRead(key, load) {
    this.scope.signal.throwIfAborted();
    if (this.pendingReads.has(key)) return this.pendingReads.get(key);
    if (this.pendingReads.size >= 128) return load();
    const pending = load().finally(() => { if (this.pendingReads.get(key) === pending) this.pendingReads.delete(key); });
    this.pendingReads.set(key, pending);
    return pending;
  }
  async tree(path = '', at = 'live') {
    const rows = await this.sharedRead(JSON.stringify(['tree', at, path]), () => this.readTree(path, at));
    return rows.map(row => ({...row}));
  }
  async readTree(path, at) {
    const entries = []; let cursor = 0;
    do {
      const page = await this.json(this.w('tree', {path, at, cursor: String(cursor)}));
      entries.push(...page.entries); cursor = page.next;
    } while (cursor !== null && cursor !== undefined);
    if(path===''&&at==='live')this.readiness.rootTreeListed=true;
    return entries;
  }
  async file(path, at = 'live') {
    return (await this.sharedRead(JSON.stringify(['file', at, path]), () => this.readFile(path, at))).slice();
  }
  async readFile(path, at) {
    const key = JSON.stringify([at, path]), known = at !== 'live' && this.versions.get(key);
    if (known && this.cache.has(known)) return this.cache.get(known);
    const response = await this.request(this.w('file', {path, at}));
    const bytes = new Uint8Array(await response.arrayBuffer()), hash = response.headers.get('ETag');
    this.scope.signal.throwIfAborted();
    if (bytes.length > 16 * 1024 * 1024) throw new Error('File exceeds 16 MiB');
    if (hash) {
      // Bounded in-memory content cache; immutable commits can bypass the network.
      if (this.cache.size >= 8) { this.cache.clear(); this.versions.clear(); }
      if (!this.cache.has(hash)) this.cache.set(hash, bytes);
      if (at !== 'live') this.versions.set(key, hash);
      return this.cache.get(hash);
    }
    return bytes;
  }
  async write(path, bytes) { return (await this.request(this.w('file', {path}), {method: 'PUT', body: bytes})).json(); }
  annotate(kind, text, turn) { return this.json(this.w('annotate'), {kind, text, ...(turn ? {turn} : {})}); }
  log(limit = 100) { return this.json(this.w('log', {limit: String(Math.min(500, Math.max(1, limit)))})); }
  diff(a, b = 'live') { return this.json(this.w('diff', {a, b})); }
  restore(at) { return this.json(this.w('restore'), {at}); }
  trace(path, at = 'live') { return this.json(this.w('trace', {path, at})); }
  graph(path = '', since = '', limit = 20) { return this.json(this.w('graph', {path, since, limit: String(Math.min(1000, Math.max(1, limit)))})); }
  async nodeSaveRequest(route, path, body) {
    try { return await this.json(this.w(route, body === undefined ? {path} : {}), body); }
    catch (error) {
      if (/^(?:404|405|501)\b/.test(error.message))
        throw new Error(`${error.message}. If this Vault does not support node saves, update Vault and relaunch this project.`);
      throw error;
    }
  }
  saveNode(path, expected) { return this.nodeSaveRequest('node-commit', path, {path, ...(expected === undefined ? {} : {expected})}); }
  listNodeSaves(path) { return this.nodeSaveRequest('node-saves', path); }
  restoreNode(state, destination) { return this.nodeSaveRequest('node-restore', undefined, {state, destination}); }
  services() { return this.json(this.w('services')); }
  async shell() {
    const {ticket} = await this.json(this.v('shell/ticket'), {});
    return this.stream('shell', ticket);
  }
  async call(argv) {
    validateArgv(argv);
    const {ticket, call} = await this.json(this.v('call'), {argv});
    const socket = this.stream('call', ticket);
    socket.callId = call;
    return socket;
  }
  async workspaces() {
    const rows=await this.json('/workspaces');
    this.readiness.workspaceListed=Array.isArray(rows)&&rows.some(row=>row?.id===this.config.workspace);
    return rows;
  }
  async events(receive, after = '0') {
    const response = await this.request(this.v('events') + '?' + new URLSearchParams({after}));
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        pending = (pending + decoder.decode(value, {stream: true})).replace(/\r\n/g, '\n');
        let end;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const block = pending.slice(0, end); pending = pending.slice(end + 2);
          const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (data) receive(JSON.parse(data));
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  agents() { return this.json(this.v('agents')); }
  async sandboxAgents() {
    const result = await this.json(this.v('run'), {argv:['sh','-lc','for name in codex claude opencode; do command -v "$name" >/dev/null 2>&1 && printf "%s\\n" "$name"; done; :'],timeout_s:5,actor:'agent-discovery'});
    if(result.exit!==0)throw new Error('Sandbox agent discovery failed');
    return [...new Set((result.stdout_tail||'').trim().split(/\s+/).filter(name=>['codex','claude','opencode'].includes(name)))];
  }
  async terminalAgentActive(terminal) {
    const script = `import json,pathlib,sys
marker=b'ALEMBIC_TERMINAL_ID='+sys.argv[1].encode()
active=False
for proc in pathlib.Path('/proc').iterdir():
 if not proc.name.isdigit(): continue
 try:
  if marker not in (proc/'environ').read_bytes().split(b'\\0'): continue
  fields=(proc/'stat').read_text().rsplit(')',1)[1].split()
  if fields[4]=='0' or fields[2]!=fields[5] or int(fields[5])<=0: continue
  args=(proc/'cmdline').read_bytes().split(b'\\0')[:2]
  names={pathlib.PurePath(arg.decode(errors='replace')).name.removesuffix('.js') for arg in args}
  names.add((proc/'comm').read_text().strip())
  if names.intersection(('codex','claude','opencode')) or any(b'/@anthropic-ai/claude-code/' in arg for arg in args): active=True;break
 except (OSError,ValueError): pass
print(json.dumps(active))`;
    const result=await this.json(this.v('run'),{argv:['python3','-I','-c',script,terminal],timeout_s:3,actor:'terminal-session'});
    return result.exit===0 && result.stdout_tail.trim()==='true';
  }
  sessions() { return this.json(this.v('sessions')); }
  launch(agent, args = []) { return this.json(this.v('launch'), {agent, args}); }
  async attach(session) {
    const {ticket} = await this.json(this.v(`sessions/${encodeURIComponent(session.id || session)}/attach`), {});
    return this.stream('call', ticket);
  }
  stream(kind, ticket) {
    this.scope.signal.throwIfAborted();
    const url = new URL(this.config.base + this.v(kind + '/ws'));
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', ticket);
    const socket = this.sockets(url.href); socket.binaryType = 'arraybuffer';
    const close = () => socket.close(); this.scope.signal.addEventListener('abort', close, {once: true});
    socket.addEventListener('close', () => this.scope.signal.removeEventListener('abort', close), {once: true});
    return socket;
  }
  close() {
    this.scope.abort();this.cache.clear();this.versions.clear();this.invalidateReads();
  }
}
export function agentNames(value) {
  const names = typeof value === 'string' ? value.trim().startsWith('[') ? JSON.parse(value) : value.split(/[,\s]+/).filter(Boolean) : value;
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(name) || name.startsWith('-')))
    throw new Error('Invalid agents');
  return [...new Set(names)];
}
export async function detectAgents(client) { return client.agents(); }
