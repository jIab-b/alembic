import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeClient, connection, tabConnection, validateArgv, agentNames, detectAgents} from '../frontend/src/node.js';
import {mockNode, first, second} from './mock-node.mjs';
const config = {base:'http://127.0.0.1:4400',token:'test-token',workspace:'w1',vm:'v1',agents:['claude','codex']};
const setup = (t, sockets) => { const mock=mockNode(); const client=new NodeClient(config,mock.fetch,sockets);t.after(()=>client.close());return {mock,client}; };
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return {promise, resolve}; };

test('overlapping reads share transport only while pending and keep caller bytes independent', async () => {
  const response = deferred(); let calls = 0;
  const client = new NodeClient(config, () => { calls++; return calls === 1 ? response.promise : Promise.resolve(new Response('fresh')); });
  const a = client.file('source.txt'), b = client.file('source.txt');
  assert.equal(calls, 1);
  response.resolve(new Response('old'));
  const [left, right] = await Promise.all([a, b]); left[0] = 0;
  assert.equal(new TextDecoder().decode(right), 'old');
  assert.equal(new TextDecoder().decode(await client.file('source.txt')), 'fresh');
  assert.equal(calls, 2); client.close();
});

test('shared tree traversal follows pagination once and does not alias returned rows', async () => {
  const firstPage = deferred(), calls = [];
  const client = new NodeClient(config, url => {
    calls.push(url); return calls.length === 1 ? firstPage.promise : Promise.resolve(Response.json({entries: [{name:'b',kind:'file'}],next:null}));
  });
  const a = client.tree(), b = client.tree();
  firstPage.resolve(Response.json({entries:[{name:'a',kind:'file'}],next:1}));
  const [left,right] = await Promise.all([a,b]);
  assert.equal(calls.length,2); assert.deepEqual(right.map(row=>row.name),['a','b']);
  left[0].name='changed'; assert.equal(right[0].name,'a'); client.close();
});

test('failed shared reads are retried and writes invalidate pre-write and in-flight reads', async () => {
  const old = deferred(), writing = deferred(), during = deferred(), fresh = deferred();
  let reads = 0;
  const client = new NodeClient(config, (_url, init) => {
    if (init.method === 'PUT') return writing.promise;
    return [old,during,fresh][reads++].promise;
  });
  const before = client.file('source.txt');
  const write = client.write('source.txt',new Uint8Array([1]));
  const mid = client.file('source.txt');
  writing.resolve(Response.json({})); await write;
  const after = client.file('source.txt');
  old.resolve(new Response('old')); during.resolve(new Response('during'));
  await Promise.all([before,mid]);
  const shared = client.file('source.txt'); assert.equal(reads,3);
  fresh.resolve(new Response('new'));
  assert.deepEqual(await after, await shared); client.close();
  const failed = deferred(); let attempts=0;
  const retry = new NodeClient(config, () => ++attempts===1 ? failed.promise : Promise.resolve(new Response('retry')));
  const one=retry.file('source.txt'), two=retry.file('source.txt');
  failed.resolve(Response.json({error:'unavailable'},{status:503}));
  const results=await Promise.allSettled([one,two]); assert.ok(results.every(row=>row.status==='rejected'));
  assert.equal(new TextDecoder().decode(await retry.file('source.txt')),'retry'); assert.equal(attempts,2); retry.close();
});

test('tab connection survives reload, replaces old credentials and keeps the fragment if storage fails', () => {
  const values = new Map(), profiles = new Map();
  const browser = {
    location: {hash: '#'+new URLSearchParams({node:config.base,...config,agents:config.agents.join(',')}),pathname:'/',search:'?view=1'},
    sessionStorage: {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},
    localStorage: {getItem:key=>profiles.get(key),setItem:(key,value)=>profiles.set(key,value)},
    window: {history: {replaceState(_state,_title,url) { assert.ok(url.startsWith('/?view=1&workspace=')); browser.location.search=url.slice(1); browser.location.hash = ''; }}}
  };
  assert.deepEqual(tabConnection(browser),config);
  assert.equal(browser.location.hash,'');
  assert.deepEqual(tabConnection(browser),config);
  browser.location.hash = '#'+new URLSearchParams({node:config.base,token:'new',workspace:'w2',vm:'v2',agents:''});
  assert.equal(tabConnection(browser).token,'new');
  assert.equal(tabConnection(browser).workspace,'w2');
  assert.deepEqual(tabConnection(browser).agents,[]);
  browser.location.hash = '#node=javascript:bad&token=x&workspace=w&vm=v';
  assert.throws(()=>tabConnection(browser),/Invalid node/);
  browser.location.hash = ''; assert.equal(tabConnection(browser).token,'new');
  values.clear(); profiles.clear(); assert.throws(()=>tabConnection(browser),/Missing connection credentials/);
  browser.location.hash = '#'+new URLSearchParams({node:config.base,token:'x',workspace:'w',vm:'v'});
  const fragment = browser.location.hash;
  browser.localStorage.setItem = () => { throw new Error('Storage blocked'); };
  assert.equal(tabConnection(browser).token,'x'); assert.equal(browser.location.hash,fragment);
});

test('headless connection readiness requires authenticated workspace, VM and root tree routes',async t=>{
  const {mock,client}=setup(t);
  assert.deepEqual(client.readiness,{workspaceListed:false,vmVerified:false,rootTreeListed:false,error:''});
  await client.workspaces();assert.equal(client.readiness.workspaceListed,true);
  await client.verifyConnection();assert.equal(client.readiness.vmVerified,true);
  await client.tree('');assert.equal(client.readiness.rootTreeListed,true);
  client.close();
  const unauthorized=new NodeClient(config,async(url,init)=>new Response(JSON.stringify({error:'unauthorized'}),{status:401,headers:{'Content-Type':'application/json'}}));
  await assert.rejects(()=>unauthorized.workspaces(),/401 unauthorized/);
  assert.equal(unauthorized.readiness.workspaceListed,false);
});

test('a browser restart restores the requested project without borrowing another project connection', () => {
  const profiles = new Map(), tabs = new Map();
  const browser={location:{hash:'#'+new URLSearchParams({node:config.base,...config,agents:config.agents.join(',')}),pathname:'/',search:''},
    sessionStorage:{getItem:k=>tabs.get(k),setItem:(k,v)=>tabs.set(k,v)},localStorage:{getItem:k=>profiles.get(k),setItem:(k,v)=>profiles.set(k,v)},
    window:{history:{replaceState(_s,_t,url){browser.location.hash='';browser.location.search=url.slice(1);}}}};
  assert.deepEqual(tabConnection(browser),config);assert.equal(browser.location.search,'?workspace=w1');
  tabs.clear();assert.deepEqual(tabConnection(browser),config);
  browser.location.hash='#'+new URLSearchParams({node:config.base,token:'second',workspace:'w2',vm:'other'});tabConnection(browser);
  browser.location.search='?workspace=w1';assert.equal(tabConnection(browser).token,config.token);
  tabs.clear();browser.location.search='?workspace=unknown';assert.throws(()=>tabConnection(browser),/Missing connection credentials/);
  browser.location.search='';assert.equal(tabConnection(browser).workspace,'w1');
});

test('connection accepts host agents without exposing a command editor', () => {
  const argv = ['/opt/custom tool', '--model', 'anything; literal'];
  const c=connection('#'+new URLSearchParams({node:'http://127.0.0.1:4400',grant:'test-token',workspace:'w1',vm:'v1',agents:'claude,codex,opencode'}));
  assert.equal(c.token,'test-token');assert.deepEqual(c.agents,['claude','codex','opencode']);assert.equal(c.argv,undefined);
  assert.deepEqual(validateArgv(argv),argv);assert.throws(()=>validateArgv('sh'),/argv/);
  assert.throws(()=>validateArgv(['']),/executable/);assert.throws(()=>validateArgv(['x\0']),/argv/);
  assert.throws(()=>connection('#node=javascript:alert(1)&token=x&workspace=w&vm=v'),/Invalid/);
  assert.throws(()=>connection('#node=http://localhost&workspace=w&vm=v'),Error);
});

test('isolated preview origin survives tab reload and rejects controller-origin or credential URLs', () => {
  const values = new Map(), preview = 'http://127.0.0.1:4401';
  const params = {...config,node:config.base,agents:config.agents.join(','),preview};
  const browser = {location:{hash:'#'+new URLSearchParams(params),pathname:'/',search:''},
    sessionStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},
    window:{history:{replaceState(){browser.location.hash='';}}}};
  assert.equal(tabConnection(browser).preview,preview);
  assert.equal(tabConnection(browser).preview,preview);
  for(const invalid of [config.base,'http://127.0.0.1:4401/path','http://user@127.0.0.1:4401','https://example.com']) {
    assert.throws(()=>connection('#'+new URLSearchParams({...params,preview:invalid})),/Invalid preview/);
  }
});

test('tree follows cursors; raw files at commits cache by hash without aliasing live bytes', async t => {
  const {mock,client}=setup(t);
  assert.deepEqual((await client.tree('',first)).map(e=>e.name),['note.txt','preview.png','scene.svg']);
  assert.equal(mock.calls.filter(c=>c.path.endsWith('/tree')).length,2);
  const before=await client.file('note.txt',first);assert.equal(new TextDecoder().decode(before),'BEFORE');before[0]=0;
  assert.equal(new TextDecoder().decode(await client.file('note.txt',first)),'BEFORE');
  assert.equal(mock.calls.filter(c=>c.path.endsWith('/file')).length,1);
  assert.equal(new TextDecoder().decode(await client.file('note.txt')),'AFTER');
  await client.write('note.txt',Buffer.from('NEW'));
  assert.equal(new TextDecoder().decode(await client.file('note.txt')),'NEW');
  for(const call of mock.calls){assert.equal(call.headers.get('Authorization'),'Bearer test-token');assert.equal(call.credentials,'omit');}
  assert.equal(mock.calls[0].query.at,first);
});

test('history, diff, trace, graph filters, restore and errors use node shapes', async t => {
  const {mock,client}=setup(t);
  assert.equal((await client.log())[0].commit,second);
  assert.equal((await client.diff(first,second))[0].path,'note.txt');
  assert.deepEqual(mock.calls.at(-1).query,{a:first,b:second});
  assert.equal((await client.trace('preview.png',first)).steps[0].run,'r1');
  assert.equal((await client.graph('preview.png','yesterday')).edges.length,4);
  assert.deepEqual(mock.calls.at(-1).query,{path:'preview.png',since:'yesterday',limit:'20'});
  await client.graph('preview.png','',200);
  assert.equal(mock.calls.at(-1).query.limit,'200');
  await client.restore(first);assert.deepEqual(mock.restored,[first]);
  assert.equal(new TextDecoder().decode(await client.file('note.txt')),'BEFORE');
  await assert.rejects(client.file('missing'),/404 not_found: Check path/);
  const bad=new NodeClient({...config,token:'wrong'},mock.fetch);
  await assert.rejects(bad.log(),/401 unauthorized/);
  client.close();await assert.rejects(client.log(),/abort/i);
});

test('shell upgrades with a ticket only and closes with the client', async t => {
  let url,closed=0;
  const socket=new EventTarget();socket.close=()=>{closed++;socket.dispatchEvent(new Event('close'));};
  const {mock,client}=setup(t,value=>{url=new URL(value);return socket;});
  assert.equal(await client.shell(),socket);
  assert.equal(url.protocol,'ws:');assert.equal(url.pathname,'/vms/v1/shell/ws');
  assert.ok(mock.tickets.has(url.searchParams.get('ticket')));assert.ok(!url.href.includes('test-token'));
  assert.equal(mock.calls[0].method,'POST');assert.equal(socket.binaryType,'arraybuffer');client.close();assert.equal(closed,1);
});

test('resource 404s on a live VM retain their error and are never retried', async () => {
  const calls=[];
  const client=new NodeClient(config,async url=>{
    const path=new URL(url).pathname;calls.push(path);
    return path==='/vms'?Response.json([{id:'v1',workspace:'w1'}]):Response.json({error:'session_ended'},{status:404});
  });
  await assert.rejects(client.attach('expired-session'),/404 session_ended/);
  assert.deepEqual(calls,['/vms/v1/sessions/expired-session/attach']);
  assert.equal(client.config.vm,'v1');client.close();
});

test('managed read errors expose retryable publication state separately from uncertain failure',async()=>{
  const client=new NodeClient(config,async()=>Response.json({error:'publication_in_progress',retryable:true},{status:503}));
  await assert.rejects(client.file('scene.svg'),error=>error.status===503&&error.code==='publication_in_progress'&&error.retryable===true);
  client.transport=async()=>Response.json({error:'publication_uncertain',retryable:false,fix:'inspect the managed run'}, {status:503});
  await assert.rejects(client.file('scene.svg'),error=>error.status===503&&error.code==='publication_uncertain'&&error.retryable===false&&/inspect the managed run/.test(error.message));
  client.close();
});

test('host call posts argv unchanged, uses a scoped ticket and reports unsupported routes', async t => {
  let url;
  const socket=new EventTarget();socket.close=()=>{};
  const {mock,client}=setup(t,value=>{url=new URL(value);return socket;});
  const argv=['/tools/custom program','--flag','literal $(value)'];
  assert.equal(await client.call(argv),socket);
  assert.equal(url.pathname,'/vms/v1/call/ws');assert.ok(mock.tickets.has(url.searchParams.get('ticket')));
  assert.deepEqual(JSON.parse(mock.calls[0].body),{argv});assert.equal(socket.callId,'call-1');
  assert.ok(!url.href.includes('test-token'));await assert.rejects(client.call([]),/argv/);
  client.transport=async()=>Response.json({error:'unsupported',fix:'Host calls unavailable'},{status:501});
  await assert.rejects(client.call(argv),/501 unsupported: Host calls unavailable/);
  client.close();
});

test('agent discovery and session operations use the backend API', async t => {
  assert.deepEqual(agentNames('claude,codex claude'), ['claude','codex']);
  assert.deepEqual(agentNames('["opencode","codex"]'), ['opencode','codex']);
  assert.deepEqual(agentNames(''), []);
  for (const value of ['claude;touch', '["claude --flag"]', '[1]', '--shell']) assert.throws(() => agentNames(value));
  const {mock,client}=setup(t,()=>{const socket=new EventTarget();socket.close=()=>{};return socket;});
  client.config = {...config,agents:undefined};
  assert.deepEqual(await detectAgents(client),['claude','codex','opencode']);
  assert.deepEqual(await client.sessions(),[]);
  await client.attach('session-1');assert.match(mock.calls.at(-1).path,/sessions\/session-1\/attach$/);
  assert.ok(!mock.calls.some(c=>c.path.endsWith('/call')));
});

test('backend discovery supplies available agents despite stale launcher hints', async t => {
  const {mock,client}=setup(t);
  client.config = {...config,agents:['claude','codex','opencode','custom-agent']};
  assert.deepEqual(await detectAgents(client),['claude','codex','opencode']);
  client.config = {...config,agents:[]};
  assert.deepEqual(await detectAgents(client),['claude','codex','opencode']);
  assert.equal(mock.calls.filter(c => c.path.endsWith('/agents')).length,2);
});

test('authenticated event stream decodes split UTF-8, CRLF, keepalives and multiple events',async()=>{
  const events=[{id:7,kind:'agent.command',agent:'codex',vm:'v1',session:'s1'}, {id:8,kind:'annotate',text:'é'}];
  const data=new TextEncoder().encode(': keepalive\r\n\r\n'+events.map(event=>`id: ${event.id}\r\nevent: ${event.kind}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  const client=new NodeClient(config,async(url,init)=>{
    assert.equal(new URL(url).searchParams.get('after'),'6');assert.equal(init.headers.get('Authorization'),'Bearer test-token');
    return new Response(new ReadableStream({start(controller){for(const byte of data)controller.enqueue(new Uint8Array([byte]));controller.close();}}));
  });
  const seen=[];await client.events(event=>seen.push(event),'6');assert.deepEqual(seen,events);client.close();
});

test('startup verifies saved VM ownership and never invokes a VM belonging to another workspace', async () => {
  const calls=[], saved=new Map(), browser={sessionStorage:{setItem:(k,v)=>saved.set(k,v)},localStorage:{setItem:(k,v)=>saved.set(k,v)}};
  const client=new NodeClient(config,async url=>{
    const path=new URL(url).pathname;calls.push(path);
    if(path==='/vms')return Response.json([{id:'v1',workspace:'w2'},{id:'new',workspace:'w1'}]);
    throw new Error('must not access another workspace VM');
  },undefined,browser);
  client.reconnectDelays=[0];
  await assert.rejects(client.verifyConnection(),/different project/);
  await assert.rejects(client.sessions(),/different project/);
  assert.deepEqual(calls,['/vms','/vms']);assert.equal(client.config.vm,'v1');assert.equal(saved.size,0);client.close();
});
