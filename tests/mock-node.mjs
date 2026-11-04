import {createHash, randomBytes} from 'node:crypto';
import {extname} from 'node:path';

export const first = '1'.repeat(40), second = '2'.repeat(40);
import {png} from './fixture.mjs';
const svg = color => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/></svg>`);
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const mime = path => ({'.wasm':'application/wasm','.webm':'video/webm','.mp4':'video/mp4','.png':'image/png','.svg':'image/svg+xml','.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.gltf':'model/gltf+json','.glb':'model/gltf-binary'})[extname(path)] || 'application/octet-stream';
const json = (value, status = 200) => Response.json(value, {status});
export function mockNode() {
  const snapshots = new Map([[first, new Map([['note.txt', Buffer.from('BEFORE')], ['scene.svg', svg('blue')], ['preview.png', png]])],
    [second, new Map([['note.txt', Buffer.from('AFTER')], ['scene.svg', svg('orange')], ['preview.png', png]])]]);
  const live = new Map(snapshots.get(second)), calls = [], writes = [], typed = [], annotations = [], restored = [], tickets = new Set(), commands = new Map(), typedStreams = [];
  const sessions = new Map(), listeners = new Set();
  const emit = event => { for (const listener of listeners) listener(event); };
  const imageHash = hash(png), graph = {
    nodes: [
      {id:'t1',kind:'turn',actor:'claude',cmd:'Make a preview',exit:0,commit:second,parent:null,cost:null,at:'2026-10-29T00:00:00Z'},
      {id:'e1',kind:'edit',actor:'ui',cmd:'edit source',exit:0,commit:first,parent:'t1',cost:null,at:'2026-10-29T00:00:01Z'},
      {id:'r1',kind:'command',actor:'claude',cmd:'make preview',exit:0,commit:second,parent:'t1',cost:null,at:'2026-10-29T00:00:02Z'},
      {id:'r2',kind:'command',actor:'claude',cmd:'inspect preview.png',exit:0,commit:second,parent:'t1',cost:null,at:'2026-10-29T00:00:03Z'}],
    artifacts: [{path:'preview.png',hash:imageHash,size:png.length,mime:'image/png'}],
    edges: [{from:'t1',to:'r1',kind:'parent'}, {from:'e1',to:'r1',kind:'next'}, {from:'r1',to:imageHash,kind:'produced'}, {from:imageHash,to:'r2',kind:'used'}]
  };
  async function fetch(url, init = {}) {
    const request = new Request(url, init), u = new URL(url), path = u.pathname, q = u.searchParams;
    const body = ['POST','PUT'].includes(request.method) ? Buffer.from(await request.arrayBuffer()) : null;
    const data = request.method === 'POST' && body?.length ? JSON.parse(body) : {};
    calls.push({path, query: Object.fromEntries(q), method: request.method, body, headers: request.headers, credentials: init.credentials});
    if (request.headers.get('Authorization') !== 'Bearer test-token') return json({error:'unauthorized',fix:'Use a valid token'}, 401);
    if (path === '/vms') return json([{id:'v1',workspace:'w1'}]);
    if (path === '/workspaces') return json([{id:'w1',path:'/projects/test',name:'test'}]);
    if (path === '/vms/v1/agents') return json(['claude','codex','opencode']);
    if (path === '/vms/v1/sessions') return json([...sessions.values()]);
    if (['/vms/v1/launch','/vms/v1/resume'].includes(path)) {
      const previous = [...sessions.values()].find(row => (row.id || row.pid) === data.session);
      if (path.endsWith('/resume') && !previous) return json({error:'not_found'},404);
      const row = {id:`session-${sessions.size+1}`,agent:previous?.agent || data.agent,pid:100+sessions.size,external:false,attachable:true};
      sessions.set(row.id,row); return json(row);
    }
    if (/^\/vms\/v1\/sessions\/[^/]+\/attach$/.test(path)) {
      const ticket = randomBytes(16).toString('hex'); tickets.add(ticket); return json({ticket,expires:Date.now()+30000});
    }
    if (path === '/vms/v1/events') return new Response(new ReadableStream({
      start(controller) {
        const listener = event => controller.enqueue(new TextEncoder().encode(`id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`));
        listeners.add(listener);
        request.signal.addEventListener('abort',()=>{listeners.delete(listener);controller.close();},{once:true});
      }
    }),{headers:{'Content-Type':'text/event-stream'}});
    if (['/vms/v1/shell/ticket','/vms/v1/call'].includes(path) && request.method === 'POST') {
      const ticket = randomBytes(16).toString('hex'); tickets.add(ticket); commands.set(ticket, data.argv); return json({ticket,expires:Date.now()+30000,...(path.endsWith('/call')?{call:'call-1'}:{})});
    }
    if (!path.startsWith('/w/w1/')) return json({error:'not_found',fix:'Check workspace'}, 404);
    const op = path.slice('/w/w1/'.length), at = q.get('at') || 'live', files = at === 'live' ? live : snapshots.get(at), file = q.get('path') || '';
    if (['tree','file'].includes(op) && !files) return json({error:'not_found',fix:'Unknown commit'}, 404);
    if (op === 'file' && request.method === 'PUT') {
      if (file.split('/').includes('..')) return json({error:'invalid_path',fix:'Use a relative path'}, 400);
      live.set(file, body); writes.push({path:file,bytes:body}); return json({hash:hash(body)});
    }
    if (op === 'file' && request.method === 'DELETE') { live.delete(file); return json({}); }
    if (op === 'file' && request.method === 'GET') {
      if (!files.has(file)) return json({error:'not_found',fix:'Check path'}, 404);
      return new Response(files.get(file), {headers:{ETag:'"'+hash(files.get(file))+'"','Content-Type':mime(file)}});
    }
    if (op === 'tree' && request.method === 'GET') {
      const prefix = file ? file+'/' : '', names = new Map();
      for (const [p,b] of files) if (p.startsWith(prefix)) {
        const [name,...rest] = p.slice(prefix.length).split('/');
        names.set(name,{name,kind:rest.length ? 'dir':'file',mode:420,size:rest.length ? null:b.length,mtime:'2026-10-29T00:00:00Z',target:null});
      }
      const rows = [...names.values()].sort((a,b) => a.name.localeCompare(b.name)), cursor = Number(q.get('cursor')||0);
      // Two rows per page exercises the API's cursor handling without a large fixture.
      return json({root:'workspace',path:file,entries:rows.slice(cursor,cursor+2),next:rows.length>cursor+2?cursor+2:null});
    }
    if (op === 'annotate' && request.method === 'POST') { annotations.push(data); return json({}); }
    if (op === 'log') return json([{commit:second,tree:'tree2',at:'2026-10-29T00:00:02Z',actor:'claude',message:'preview',run:'r1',outputs:[{path:'preview.png',hash:imageHash}]},
      {commit:first,tree:'tree1',at:'2026-10-29T00:00:01Z',actor:'user',message:'import',run:null,outputs:[]}]);
    if (op === 'graph') return json(q.get('path') && !graph.artifacts.some(a => a.path === q.get('path')) ? {nodes:[],artifacts:[],edges:[]} : graph);
    if (op === 'diff') return json([{path:'note.txt',change:'modified',before:hash(Buffer.from('BEFORE')),after:hash(Buffer.from('AFTER'))}]);
    if (op === 'restore' && request.method === 'POST') {
      if (!snapshots.has(data.at)) return json({error:'not_found',fix:'Check commit'}, 404);
      live.clear(); for (const [p,b] of snapshots.get(data.at)) live.set(p,b); restored.push(data.at); return json({commit:'3'.repeat(40)});
    }
    if (op === 'trace') return json({path:file,hash:imageHash,steps:[{run:'r1',argv:['make','preview'],actor:'claude',env:'host',commit:second,inputs_heavy:[]}],scripts:[]});
    if (op === 'services') return json({services:[],vms:['v1']});
    return json({error:'not_found',fix:'Unsupported mock route'}, 404);
  }
  return {fetch,calls,writes,typed,annotations,restored,tickets,commands,typedStreams,graph,live,snapshots,sessions,emit};
}
