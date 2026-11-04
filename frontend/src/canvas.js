// A scene index, not another asset container. Receipts describe actual exported bytes.
import {readInteraction} from './native-stream.js';
const pathOK = path => typeof path === 'string' && path.length <= 500 && !/[\\\x00-\x1f]/.test(path) && path.split('/').every(part => part && !part.startsWith('.'));
const digestOK = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function readCanvas(bytes, threeD) {
  if (bytes.length > 262144) throw new Error('Canvas exceeds 256 KiB');
  const doc = JSON.parse(new TextDecoder().decode(bytes));
  const fail = () => { throw new Error('Invalid canvas: expected a bounded scene graph with relative paths and valid views'); };
  if (bytes.length > 262144 || doc?.format !== 'alembic.canvas' || doc.version !== 1 || typeof doc.title !== 'string' || !doc.title || doc.title.length > 160 ||
      !Array.isArray(doc.nodes) || !doc.nodes.length || doc.nodes.length > 64 || !Array.isArray(doc.views) || !doc.views.length) fail();
  const ids = new Set();
  for (const n of doc.nodes) {
    if (n && typeof n.path === 'string' && n.label === undefined && doc.views.includes(n.id)) {
      const extension = n.path?.split('.').at(-1)?.toLowerCase(), app = n.application;
      const same = doc.views.filter(id => doc.nodes.find(node => node.id === id)?.application === app && app === 'blender').length;
      const glbs = doc.views.filter(id => /\.(glb|gltf)$/i.test(doc.nodes.find(node => node.id === id)?.path || '')).length;
      n.label = extension === 'stream' ? app === 'blender' ? `Blender${same > 1 ? ` · ${n.path.split('/').at(-1).slice(0, -7)}` : ''}` : app === 'godot' ? 'Godot' : ''
        : ['glb','gltf'].includes(extension) ? `GLB${glbs > 1 ? ` · ${n.path.split('/').at(-1).replace(/\.(glb|gltf)$/i,'')}` : ''}` : extension?.toUpperCase();
    }
    if (!n || typeof n.id !== 'string' || !/^[\w-]{1,64}$/.test(n.id) || ids.has(n.id) || !pathOK(n.path) || /\.canvas$/i.test(n.path) ||
        typeof n.label !== 'string' || !n.label || n.label.length > 160 || n.application !== undefined && (!/\.stream$/i.test(n.path) || !['blender','godot'].includes(n.application)) ||
        n.actions !== undefined && (!Array.isArray(n.actions) || n.application !== 'godot' || n.actions.length > 8 ||
          n.actions.some(a => !a || typeof a.label !== 'string' || !a.label || a.label.length > 32 || !['f','r','e','Tab','Return','Shift_L','Control_L'].includes(a.key)) ||
          new Set(n.actions.map(a => a.key)).size !== n.actions.length) ||
        !Array.isArray(n.inputs) || n.inputs.length > 32 || new Set(n.inputs).size !== n.inputs.length ||
        ['capabilities', 'limitations'].some(key => n[key] !== undefined && (!Array.isArray(n[key]) || n[key].length > 12 || n[key].some(s => typeof s !== 'string' || s.length > 300)))) fail();
    ids.add(n.id);
    if(doc.views.includes(n.id)||n.interaction!==undefined)n.interaction=readInteraction(n.interaction,{threeD:threeD!==false&&(/\.(glb|gltf|stream)$/i.test(n.path)||threeD===true&&/\.html$/i.test(n.path))});
    if (n.receipt && (!digestOK(n.receipt.output) || !n.receipt.inputs || typeof n.receipt.inputs !== 'object' || Array.isArray(n.receipt.inputs) ||
        Object.entries(n.receipt.inputs).some(([id, hash]) => !n.inputs.includes(id) || !digestOK(hash)) ||
        (n.receipt.resources !== undefined && (!n.receipt.resources || typeof n.receipt.resources !== 'object' || Array.isArray(n.receipt.resources))) ||
        Object.entries(n.receipt.resources || {}).some(([path, hash]) => !pathOK(path) || !digestOK(hash)) || Object.keys(n.receipt.resources || {}).length > 32)) fail();
  }
  if (new Set(doc.views).size !== doc.views.length || doc.views.some(id => !ids.has(id)) || !doc.views.includes(doc.defaultView)) fail();
  const byId = new Map(doc.nodes.map(n => [n.id, n])), visiting = new Set(), layers = new Map();
  function depth(id) {
    if (!ids.has(id) || visiting.has(id)) fail();
    if (layers.has(id)) return layers.get(id);
    visiting.add(id);
    const n = byId.get(id), layer = n.inputs.length ? 1 + Math.max(...n.inputs.map(depth)) : 0;
    visiting.delete(id); layers.set(id, layer); return layer;
  }
  doc.nodes.forEach(n => depth(n.id));
  if (doc.views.some(id => !/\.(?:stream|godot|glb|gltf|html|js|svg|png|jpe?g|webp|gif|avif|json|wav|mp3|ogg|flac|m4a|aac|opus|mp4|webm)$/i.test(byId.get(id).path))) fail();
  return doc;
}
export function canvasLayout(doc) {
  const byId = new Map(doc.nodes.map(n => [n.id, n])), depths = new Map(), rows = new Map();
  const depth = n => depths.has(n.id) ? depths.get(n.id) : (depths.set(n.id, n.inputs.length ? 1 + Math.max(...n.inputs.map(id => depth(byId.get(id)))) : 0), depths.get(n.id));
  return doc.nodes.map(n => { const col = depth(n), row = rows.get(col) || 0; rows.set(col, row + 1); return {...n, x: 36 + col * 300, y: 32 + row * 190}; });
}
export async function canvasStatus(doc, hashFile) {
  const pending = new Map(), hashes = new Map();
  const hash = path => { if (!hashes.has(path)) hashes.set(path, Promise.resolve().then(() => hashFile(path)).catch(() => null)); return hashes.get(path); };
  function inspect(n) {
    if (!pending.has(n.id)) pending.set(n.id, (async () => {
      const [output, inputs] = await Promise.all([hash(n.path), Promise.all(n.inputs.map(id => inspect(doc.nodes.find(n => n.id === id))))]);
      if (!output) return {state: 'missing', reason: 'File unavailable', hash: null};
      if (n.build?.state === 'building' || n.build?.state === 'failed') return {state: n.build.state, reason: n.build.message || 'Showing the last available export', hash: output};
      if (/\.stream$/i.test(n.path)) return {state: 'native', reason: 'Native 3D view of the saved source', hash: output};
      if (!n.inputs.length && !n.receipt) return {state: 'source', reason: 'Editable source', hash: output};
      if (!n.receipt) return {state: 'unverified', reason: 'No export receipt', hash: output};
      const resources = await Promise.all(Object.entries(n.receipt.resources || {}).map(async ([path, value]) => await hash(path) === value));
      const current = output === n.receipt.output && inputs.every((input, i) => ['current', 'source'].includes(input.state) && input.hash === n.receipt.inputs[n.inputs[i]]) && resources.every(Boolean);
      return {state: current ? 'current' : 'stale', reason: current ? 'Matches its recorded inputs' : 'Sources or export changed since the last verified build', hash: output};
    })());
    return pending.get(n.id);
  }
  return Object.fromEntries(await Promise.all(doc.nodes.map(async n => [n.id, await inspect(n)])));
}

// One background inspection at a time. A changed view invalidates queued work;
// in-flight reads may finish, but cannot publish or start further reads.
export function canvasInspector(inspect, publish, concurrency = 4) {
  let generation = 0, running = false, pending = null;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const job = pending; pending = null;
        const waiting = [], active = {count: 0};
        const current = () => job.generation === generation;
        const pump = () => {
          while (current() && active.count < concurrency && waiting.length) {
            const {path, resolve, reject} = waiting.shift(); active.count++;
            Promise.resolve().then(() => inspect(job.context, path)).then(resolve, reject).finally(() => { active.count--; pump(); });
          }
          if (!current()) while (waiting.length) waiting.shift().reject(new Error('Obsolete inspection'));
        };
        const hash = path => new Promise((resolve, reject) => { waiting.push({path, resolve, reject}); pump(); });
        const status = await canvasStatus(job.document, hash);
        if (current()) publish(job.context, status);
      }
    } finally { running = false; if (pending) void drain(); }
  }
  return {
    request(document, context) { const id = ++generation; pending = {document, context, generation: id}; void drain(); },
    get busy() { return running; },
    cancel() { generation++; pending = null; }
  };
}

// Typed nodes own their view; the graph is optional metadata inside the same
// existing node manifest. Legacy .canvas documents remain readable.
export const isTypedNode = path => /\.(?:i3d|i2d|audio|iframe)$/i.test(path);
export function resolveNodePath(base, value) {
  if (typeof value !== 'string' || !value || /[\\\x00-\x1f:]/.test(value) || value.startsWith('/')) throw new Error('Invalid node view path');
  const parts = base ? base.split('/') : [];
  for (const part of value.split('/')) {
    if (part === '..') { if (!parts.length) throw new Error('Node view escapes project'); parts.pop(); }
    else if (!part || part.startsWith('.')) throw new Error('Invalid node view path');
    else parts.push(part);
  }
  const result = parts.join('/');
  if (!pathOK(result)) throw new Error('Invalid node view path');
  return result;
}
export function readNode(bytes, path, directory = true) {
  if (bytes.length > 262144) throw new Error('Node manifest exceeds 256 KiB');
  const spec = JSON.parse(new TextDecoder().decode(bytes));
  if (['alembic.canvas', 'alembic.composition'].includes(spec?.format) && !directory) {
    return readCanvas(new TextEncoder().encode(JSON.stringify({...spec, format: 'alembic.canvas'})),/\.i3d$/i.test(path));
  }
  if (spec?.format !== 'alembic.node' || spec.version !== 1 || !spec.dependencies ||
      typeof spec.dependencies !== 'object' || Array.isArray(spec.dependencies) || !pathOK(spec.entry))
    throw new Error('Expected an alembic.node manifest with entry and explicit dependencies');
  const base = directory ? path : path.slice(0, Math.max(0, path.lastIndexOf('/')));
  const resolve = value => resolveNodePath(base, value);
  const topLevelGraph = !spec.scene && Array.isArray(spec.nodes);
  if (!spec.scene && !topLevelGraph) return {format: 'alembic.canvas', version: 1, title: spec.title || path.split('/').pop(),
    nodes: [{id: 'entry', path: resolve(spec.entry), label: spec.title || path.split('/').pop(), inputs: [],interaction:readInteraction(spec.interaction,{threeD:/\.i3d$/i.test(path)&&/\.(glb|gltf|stream|html)$/i.test(spec.entry)})}], views: ['entry'], defaultView: 'entry'};
  const doc = topLevelGraph
    ? {...structuredClone(spec), format: 'alembic.canvas'} : structuredClone(spec.scene);
  if (!Array.isArray(doc.nodes)) throw new Error('Invalid node scene');
  for (const node of doc.nodes) {
    node.path = resolve(node.path);
    if (node.receipt?.resources && !topLevelGraph) node.receipt.resources = Object.fromEntries(Object.entries(node.receipt.resources).map(([key, value]) => [resolve(key), value]));
  }
  return readCanvas(new TextEncoder().encode(JSON.stringify(doc)),/\.i3d$/i.test(path));
}
// A small, tab-separated index of real files and key-triggered native actions.
// It declares no executable behavior; that remains in the selected source.
export function readView(bytes, path) {
  if (bytes.length > 65536) throw new Error('View index exceeds 64 KiB');
  const nodes = [], views = [], actions = [], interactions = [], lines = new TextDecoder().decode(bytes).split(/\r?\n/);
  let defaultView = '', version = false;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const [kind, ...parts] = line.split('\t');
    if (!version) {
      if (kind !== 'view-index' || parts.length !== 1 || parts[0] !== '1') throw new Error('Unsupported view index version');
      version = true; continue;
    }
    if (kind === 'default' && parts.length === 1 && !defaultView) defaultView = parts[0];
    else if (kind === 'view' && parts.length === 3) {
      const [id, type, file] = parts;
      if (!['glb','gltf','blender','godot'].includes(type) ||
          !(type === 'blender' || type === 'godot' ? /\.stream$/i : new RegExp(`\\.${type}$`, 'i')).test(file)) throw new Error('Invalid view index target');
      nodes.push({id, path: resolveNodePath(path, file), inputs: [], ...(type === 'blender' || type === 'godot' ? {application: type} : {}), ...(type === 'godot' ? {actions: []} : {})});
      views.push(id);
    } else if (kind === 'action' && parts.length === 3) actions.push(parts);
    else if (kind === 'interaction' && parts.length === 3) interactions.push(parts);
    else throw new Error('Invalid view index record');
  }
  for (const [id, label, binding] of actions) {
    const node = nodes.find(n => n.id === id);
    if (!node || node.application !== 'godot') throw new Error('Action requires a Godot view');
    if (!binding.startsWith('key:')) throw new Error('Unsupported action binding');
    node.actions.push({label, key: binding.slice(4)});
  }
  interactionRows(nodes,interactions);
  return readCanvas(new TextEncoder().encode(JSON.stringify({format:'alembic.canvas',version:1,title:path.split('/').pop(),nodes,views,defaultView})),/\.i3d$/i.test(path));
}
export function interactionRows(nodes,rows){
  for(const [id,key,value] of rows){
    if(key==='screen_lock')continue; // Retired export rows remain readable.
    const node=nodes.find(row=>row.id===id);
    if(!node || key!=='io_lock' || !['true','false'].includes(value) || Object.hasOwn(node.interaction||{},key))
      throw Error('Invalid interaction permissions');
    (node.interaction??={})[key]=value==='true';
  }
}
export async function openNodeDocument(folder, path, directory) {
  if (!isTypedNode(path)) {
    const bytes = await folder.read(path);
    return {bytes, source: path, directory: false, document: readCanvas(bytes)};
  }
  // A known entry (file-tree row, restored tab) skips the parent listing entirely.
  if (directory === undefined) {
    const slash = path.lastIndexOf('/'), parent = slash < 0 ? '' : path.slice(0, slash), name = path.slice(slash + 1);
    directory = (await folder.list(parent)).find(entry => entry.name === name)?.directory === true;
  }
  let source = path, bytes, viewSource, exportSource, dependencies = {};
  if (directory) {
    // One raw directory listing selects the descriptor; a blind legacy read costs a slow missing-file GET.
    const present = new Set((await folder.entries(path)).filter(entry => !entry.directory).map(entry => entry.name));
    const current = present.has('.node.txt'), legacy = present.has('manifest.json');
    if (current && legacy) throw new Error('Both .node.txt and manifest.json exist; resolve the descriptors before opening this node');
    if (current) source = path + '/.node.txt';
    else if (legacy) source = path + '/manifest.json';
    else throw new Error('Node descriptor is missing');
    if (present.has('view.txt')) viewSource = path + '/view.txt';
    if (present.has('exports.txt')) exportSource = path + '/exports.txt';
    if (viewSource && exportSource) throw new Error('Both exports.txt and legacy view.txt exist');
  }
  bytes = await folder.read(source);
  if (viewSource || exportSource) {
    readNode(bytes, path, directory); // Retain descriptor validation and save boundary.
    dependencies = JSON.parse(new TextDecoder().decode(bytes)).dependencies;
    source = exportSource || viewSource;
    bytes = await folder.read(source);
  }
  const document = exportSource ? (await import('./node-contract.js')).readExports(bytes, path)
    : viewSource ? readView(bytes, path) : readNode(bytes, path, directory);
  return {bytes, source, directory, document, dependencies};
}

// Only direct, viewable node references are listed; assets and saved-state
// dependencies are deliberately not opened while building the menu.
export async function childNodes(folder, path, ancestors = []) {
  if (!/\.i3d$/i.test(path)) return [];
  const entries = await folder.entries(path), names = new Set(entries.filter(e => !e.directory).map(e => e.name));
  if (names.has('.node.txt') && names.has('manifest.json')) throw new Error('Both node descriptors exist');
  const descriptor = names.has('.node.txt') ? '.node.txt' : names.has('manifest.json') ? 'manifest.json' : '';
  if (!descriptor) throw new Error('Node descriptor is missing');
  const spec = JSON.parse(new TextDecoder().decode(await folder.read(path + '/' + descriptor)));
  const found = new Set(entries.filter(e => e.directory && /\.i3d$/i.test(e.name)).map(e => path + '/' + e.name));
  for (const ref of Object.values(spec.dependencies || {})) {
    if (ref && typeof ref.path === 'string' && /\.i3d$/i.test(ref.path)) found.add(resolveNodePath(path, ref.path));
  }
  const result = [...found].filter(value => value !== path && !ancestors.includes(value)).sort();
  if (result.length > 64) throw new Error('More than 64 child nodes; narrow this node before browsing playback');
  return result;
}
