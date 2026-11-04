import {ports} from '../frontend/src/contract/ports.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {readFile, readdir} from 'node:fs/promises';
import {frontendModules} from './frontend-modules.mjs';
import {mockNode} from './mock-node.mjs';
import {NodeClient} from '../frontend/src/node.js';
import {container,pack} from '../render/babylon/document.js';
import {editSolid,readSolids} from '../render/babylon/solids.js';
const {folder:{nodeFolder,optionalRead},backends:{nodeBackend,webBackend},workspace:{createWorkspace}} = await frontendModules();
const config = {base:'http://node.test',token:'test-token',workspace:'w1',vm:'v1',agents:['claude','codex','opencode']};

async function workspace(configure = () => {}, spatial = false) {
  const mock = mockNode(), previous = new Map(), mounts = [], events = new EventTarget(), ticks = [], replies = [];
  const set = (key,value) => { previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key)); Object.defineProperty(globalThis,key,{value,writable:true,configurable:true}); };
  set('__uiMounts',mounts);set('requestAnimationFrame',()=>1);set('cancelAnimationFrame',()=>{});
  set('location',{hash:'#'+new URLSearchParams({...config,agents:config.agents.join(',')}),href:'http://ui.test/',pathname:'/',search:spatial ? '?experiment=spatial-prompts' : ''});
  set('window',{history:{replaceState(...args){ mock.address = args[2]; }}});
  set('localStorage',{getItem(){return 'light';},setItem(){}});
  set('sessionStorage',{getItem(){return null;},setItem(){}});
  set('navigator',{serviceWorker:{register:async()=>({active:{}})}});
  set('addEventListener',events.addEventListener.bind(events));set('removeEventListener',events.removeEventListener.bind(events));
  set('setInterval',callback => { ticks.push(callback); return ticks.length; });set('clearInterval',()=>{});
  set('WebSocket',class extends EventTarget { constructor() { super(); setTimeout(() => { this.onopen?.(); const out = replies.shift(); if (out) this.onmessage?.({data: out}); this.onclose?.(); this.dispatchEvent(new Event('close')); }); } send() {} close() {} });
  set('fetch',(url,init) => String(url).includes('/assets/runtimes/manifest.json') ? Promise.resolve(Response.json([]))
    : mock.fetch(url,init));
  const viewer = {load:async()=>{},objects:()=>[{node:0,name:'Triangle'}],crop:async()=>new Uint8Array([137,80,78,71]),
    animation:()=>null,volumes(){},tool(){},defaultRadius:()=>1,replayPose:()=>({position:[0,0,1],target:[0,0,0]}),
    restoreReplayPose(){},dispose(){},pose(){},project:()=>[100,100],dragFrame:()=>({right:[1,0,0],up:[0,1,0],forward:[0,0,-1],scale:.01}),locate:()=>({point:[0,0,0],object:{node:0,name:'Triangle'}})};
  viewer.render = Object.fromEntries(ports.i3d.map(name => [name, async () => {}]));
  set('__uiViewer',{createViewer:async(_host,onplace)=>{viewer.place=onplace;return viewer;}});
  const transport = mock.fetch;
  mock.fetch = (url, init) => new URL(url).pathname.endsWith('/agents')
    ? Promise.resolve(Response.json(['codex'])) : transport(url, init);
  configure(mock);
  const v = createWorkspace(); mock.prompts=[]; v.bindTerminalPrompt(async text => mock.prompts.push(text)); v.host =
    {}; v.viewport = {getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})};
  const dispose = mounts[0]();
  await window.__alembic.ready();
  await Promise.resolve();
  return {v,mock,viewer,events,ticks,replies,async close() { dispose(); for (const [key,descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key]; } }};
}

function workspaceTest(name, run, ...args) {
  test(name, async t => {
    const w = await workspace(...args);
    t.after(() => w.close());
    await run(w);
  });
}

function folderTest(name, run) {
  test(name, async t => {
    const mock=mockNode(), client=new NodeClient(config,mock.fetch);
    t.after(() => client.close());
    await run({mock,client,folder:nodeFolder(client)});
  });
}

async function settleCanvas(v) { do await new Promise(resolve => setTimeout(resolve, 5)); while (v.ask?.state === 'brew'); }
const launches = mock => mock.calls.filter(c => c.path.endsWith('/launch')).map(c => JSON.parse(c.body));

folderTest('the node folder preserves explorer ordering, stat, writes, hidden filtering and missing files',async ({mock,client,folder})=>{
  await client.write('z/10.txt',Buffer.from('ten'));await client.write('z/2.txt',Buffer.from('two'));
  await client.write('.secret',Buffer.from('hidden'));
  assert.deepEqual((await folder.list()).map(e=>e.name),['z','note.txt','preview.png','scene.svg']);
  assert.deepEqual((await folder.list('z')).map(e=>e.name),['2.txt','10.txt']);
  assert.equal((await folder.stat('note.txt')).size,5);
  assert.equal(await optionalRead(folder,'missing'),null);
  for (const path of ['../secret','/secret','z/./2.txt','z//2.txt','z\\2.txt']) await assert.rejects(folder.read(path),/relative path/);
  await folder.write('.alembic/crops/s1.png',Buffer.from('png'));
  assert.equal(Buffer.from(await folder.read('.alembic/crops/s1.png')).toString(),'png');
});

test('sandbox agent discovery verifies installed commands without host fallback',async()=>{
  const empty=await workspace(mock=>{const fetch=mock.fetch;mock.fetch=(url,init)=>
    new URL(url).pathname.endsWith('/agents')?Promise.resolve(Response.json([])):fetch(url,init);});
  try {
    assert.deepEqual([...empty.v.agents],[]);
    assert.match(empty.v.agentIssue,/No supported agents are installed/);
    await assert.rejects(empty.v.say('Inspect',[]),/sandbox terminal/);
    assert.equal(launches(empty.mock).length,0);
  } finally { await empty.close(); }
  const stored=new Map(), available=await workspace(mock=>{
    globalThis.localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
  });
  try {
    assert.deepEqual([...available.v.agents],['codex']);assert.equal(available.v.variant,'codex');
    available.v.variant='claude';assert.equal(available.v.variant,'codex');
    assert.equal(launches(available.mock).length,0);
  } finally { await available.close(); }
});

workspaceTest('restored tabs preserve highlights, blank canvases, theme and live file updates',async w=>{
  const {v,mock}=w;
    assert.equal(v.theme,'light');assert.deepEqual([...v.agents],['codex']);assert.equal(mock.address,'/?workspace=w1');
    await v.open('note.txt');assert.equal(v.text,'AFTER');const first=v.activeTab;
    await v.add({id:'s1',shape:'area',tag:'note',area:[.1,.1,.3,.3],objects:[],crop:null});
    await v.open('scene.svg');const second=v.activeTab;assert.notEqual(first,second);
    await v.switchTab(first);assert.equal(v.file,'note.txt');assert.equal(v.selections[0].tag,'note');
    assert.equal(v.active,'s1');assert.equal(v.tabs.length,2);
    await v.newTab();const blank=v.activeTab;assert.equal(v.file,'');
    await v.switchTab(second);await v.switchTab(blank);assert.equal(v.file,'');
    await v.closeTab(blank);assert.equal(v.file,'scene.svg');
    await v.switchTab(first);
    mock.live.set('note.txt',Buffer.from('EDIT!')); // Same size and mtime: compare bytes too.
    await w.ticks[0]();await v.run(async()=>{});assert.equal(v.text,'EDIT!');
    await v.remove('s1');assert.equal(v.selections.length,0);
    const saved=JSON.parse(mock.live.get('.alembic/selection.json'));assert.equal(saved.file,'note.txt');assert.deepEqual(saved.selections,[]);
    assert.ok(!mock.calls.some(c=>/\/(log|graph|restore|trace|diff)$/.test(c.path)));
  });

workspaceTest('click-away deletes prompt drafts, hides saved prompts, and retains real geometry',async w=>{
  const {v,mock}=w;
    mock.live.set('draft.gltf',Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]})));
    await v.open('draft.gltf');
    await v.add({id:'saved',tag:'Keep this prompt',shape:'sphere',center:[0,0,0],radius:1,objects:[],crop:null});
    await v.add({id:'draft',tag:'',shape:'box',center:[2,0,0],size:[1,1,1],objects:[],crop:null});
    assert.deepEqual(v.visible.map(s=>s.id),['draft']);
    await v.dismiss();
    assert.equal(v.visible.length,0);assert.equal(v.active,'');
    assert.deepEqual(v.selections.map(s=>s.id),['saved']);
    assert.deepEqual(JSON.parse(mock.live.get('.alembic/selection.json')).selections.map(s=>s.id),['saved']);
    v.choose('saved');await v.dismiss();assert.equal(v.selections.length,1);assert.equal(v.visible.length,0);
    await v.add({id:'first-draft',tag:'',shape:'sphere',center:[1,0,0],radius:1,objects:[],crop:null});
    await v.add({id:'next-draft',tag:'',shape:'sphere',center:[2,0,0],radius:1,objects:[],crop:null});
    assert.deepEqual(v.selections.map(s=>s.id),['saved','next-draft']);
    await v.remove('next-draft');assert.equal(v.visible.length,0); // An older prompt must not reappear.
    v.setShapeMode('real');
    await v.add({id:'solid',tag:'',shape:'box',center:[0,0,0],size:[2,2,2],objects:[],crop:null});
    await v.dismiss();assert.equal(readSolids(mock.live.get('draft.gltf')).length,1);
    assert.deepEqual(v.selections.map(s=>s.id),['saved','solid']);assert.equal(v.visible.length,0);
  });

workspaceTest('experimental prompt drafts survive deselection and tabs, then X removes only its highlight',async w=>{
  const {v,mock}=w;
    mock.live.set('draft.gltf',Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]})));
    await v.open('draft.gltf');
    await v.add({id:'a',tag:'',shape:'sphere',center:[0,0,0],radius:1,objects:[],crop:null});
    v.openAsk('a',100,100);v.ask.text='Warm this brass';const anchor=[...v.ask.point];
    await v.dismiss();assert.equal(v.active,'');assert.equal(v.selections.length,1);assert.equal(v.promptNodes[0].text,'Warm this brass');
    await v.add({id:'b',tag:'',shape:'sphere',center:[3,0,0],radius:1,objects:[],crop:null});
    v.openAsk('b',300,100);v.ask.text='Cool this stone';
    assert.equal(v.promptNodes.length,2);assert.equal(v.visible.length,2);
    v.openAsk('a',150,180);assert.equal(v.ask.text,'Warm this brass');assert.deepEqual([...v.ask.point],anchor);
    const tab=v.activeTab;await v.open('scene.svg');await v.switchTab(tab);
    assert.equal(v.promptNodes.length,2);assert.equal(v.visible.length,2);
    await v.closePrompt('a');assert.equal(v.promptNodes.length,1);assert.deepEqual(v.selections.map(s=>s.id),['b']);
    await v.remove('b');assert.deepEqual(v.selections.map(s=>s.id),[]);assert.equal(v.promptNodes.length,0);
  }, ()=>{}, true);

test('unavailable startup sessions leave file UI and periodic session recovery running',async()=>{
  let available=false;
  let w;
  try {
    w=await workspace(mock=>{
      const transport=mock.fetch;
      mock.fetch=(url,init)=>{
        const path=new URL(url).pathname;
        if(!available&&path==='/vms/v1/sessions')return Promise.resolve(Response.json({error:'not_found'},{status:404}));
        if(path==='/vms')return Promise.resolve(Response.json(available?[{id:'v1',workspace:'w1'}]:[]));
        return transport(url,init);
      };
    });
    assert.equal(w.ticks.length,2);assert.match(w.v.error,/server is stopped or unavailable/);
    await w.v.open('note.txt');assert.equal(w.v.text,'AFTER');
    available=true;w.mock.sessions.set('external',{pid:17,agent:'codex',external:true,last_command:2});
    w.ticks[1]();await turn();await turn();
    assert.equal(w.v.selectedSession,undefined);assert.equal(w.v.error,'');
  } finally {
    if(w)await w.close();
  }
});

workspaceTest('selection prompts preserve crops and geometry for confined Codex without host launch',async w=>{
  const {v,mock}=w;
    mock.live.set('model.glb',Buffer.from('fixture'));
    await v.open('model.glb');
    await v.add({id:'s1',shape:'sphere',tag:'',center:[0,0,0],radius:1,objects:[],crop:null});
    v.choose('s1');v.setCanvasPromptMode('chat');v.openAsk('s1',100,100);await v.brew('Make it blue');
    assert.match(mock.prompts.at(-1),/Make it blue/);
    const description=mock.writes.findLast(w=>w.path.startsWith('.alembic/selections/'));
    const doc=JSON.parse(description.bytes);assert.equal(doc.file,'model.glb');assert.equal(doc.selection.shape,'sphere');
    assert.deepEqual(doc.selection.objects,[{node:0,name:'Triangle'}]);assert.ok(mock.live.has(doc.selection.crop));
    assert.equal(mock.annotations.at(-1).kind,'selection');
    assert.equal(launches(mock).length,0);assert.deepEqual(v.chatLog,[]);
  });

workspaceTest('closing a prompt removes its fresh highlight and draft but keeps other saved annotations',async w=>{
  const {v,mock}=w;
    await v.open('note.txt');
    await v.add({id:'saved',shape:'area',tag:'Saved annotation',area:[0,0,.2,.2],objects:[],crop:null});
    v.openAsk('saved',40,40);await v.closePrompt('saved');
    assert.equal(v.ask,null);assert.deepEqual(v.selections.map(s=>s.id),['saved']);
    await v.add({id:'temporary',shape:'area',tag:'',area:[.3,.3,.5,.5],objects:[],crop:null});
    v.openAsk('temporary',70,70);v.ask.text='Unsent draft';await v.closePrompt('temporary');
    assert.equal(v.ask,null);assert.deepEqual(v.selections.map(s=>s.id),['saved']);
    assert.equal(mock.live.get('note.txt').toString(),'AFTER');
  });

workspaceTest('new-session canvas prompts are disabled for the sandbox terminal',async w=>{
  const {v,mock}=w;
    assert.equal(v.canvasPromptMode,'chat');v.setCanvasPromptMode('new-session');
    await v.open('note.txt');await v.add({id:'s1',shape:'area',tag:'',area:[0,0,.5,.5],objects:[],crop:null});
    assert.match(v.canvasPromptDisabled,/Continue chat with the sandbox terminal/);
    v.openAsk('s1',100,100);await assert.rejects(v.brew('Canvas only'),/Continue chat with the sandbox terminal/);
    assert.equal(launches(mock).length,0);
  });

workspaceTest('Continue chat prepares captured context for native paste without launching host agent',async w=>{
  const {v,mock}=w;
    await v.open('scene.svg');await v.add({id:'s1',shape:'area',tag:'',area:[0,0,.5,.5],objects:[],crop:'.alembic/crops/original.png'});
    v.selections[0].crop='.alembic/crops/original.png';
    mock.live.set('.alembic/crops/original.png',Buffer.from('original crop'));
    v.setCanvasPromptMode('chat');
    v.openAsk('s1',100,100);await v.brew('Continue this');
    assert.equal(v.ask.note,'Brewing');assert.equal(v.ask.state,'brew');
    assert.equal(v.chatReveal,1);
    const stored=JSON.parse(mock.writes.findLast(write=>write.path.startsWith('.alembic/selections/')).bytes);
    assert.equal(stored.file,'scene.svg');assert.equal(stored.selection.shape,'area');
    assert.equal(stored.selection.crop,'.alembic/crops/original.png');
    assert.match(mock.prompts.at(-1),/Continue this/);assert.equal(launches(mock).length,0);
  });

workspaceTest('selecting an animated highlight and opening its prompt preserves the current camera',async w=>{
  const {v,mock,viewer}=w;
    mock.live.set('model.glb',Buffer.from('fixture'));
    viewer.animation=()=>({duration:2,seek(){}});
    const restored=[];viewer.restoreReplayPose=pose=>restored.push(pose);
    await v.open('model.glb');
    await v.add({id:'s1',shape:'sphere',tag:'Saved',center:[0,0,0],radius:1,objects:[],crop:null});
    assert.ok(v.selections[0].temporal.camera);
    viewer.replayPose=()=>({position:[5,3,8],target:[1,1,1]});
    v.choose('s1');v.openMenu('s1',200,200);v.openAsk('s1',v.menu.x,v.menu.y);
    assert.deepEqual(restored,[]);assert.deepEqual(viewer.replayPose().position,[5,3,8]);
    assert.equal(v.ask.id,'s1');
  });

workspaceTest('Codex canvas prompts prepare a confined-session draft without launching a host agent',async w=>{
  const {v,mock}=w;
    await v.open('note.txt');await v.add({id:'s1',shape:'area',tag:'',area:[0,0,.5,.5],objects:[],crop:null});
    v.variant='codex';v.setCanvasPromptMode('chat');
    await v.selectAgent({pid:7,agent:'claude',external:true});
    assert.equal(v.canvasPromptDisabled,'');
    v.openAsk('s1',100,100);await v.brew('Canvas only');
    assert.equal(v.ask.state,'brew');assert.equal(v.ask.note,'Brewing');
    assert.match(mock.prompts.at(-1),/Canvas only/);assert.equal(launches(mock).length,0);
    assert.deepEqual(v.chatLog,[]);assert.equal(v.chatReveal,1);
    v.clearNativeDraft();assert.equal(v.nativeDraft,'');
  });

test('canvas prompt setting is restored, persisted, and invalid stored modes use the chat default',async()=>{
  let stored=JSON.stringify({canvasPromptMode:'chat',other:'preserve'});
  let w=await workspace(()=>{globalThis.localStorage={getItem:key=>key==='alembic-settings'?stored:null,setItem:(key,value)=>{if(key==='alembic-settings')stored=value;}};});
  try {assert.equal(w.v.canvasPromptMode,'chat');w.v.setCanvasPromptMode('new-session');assert.deepEqual(JSON.parse(stored),{canvasPromptMode:'new-session',other:'preserve'});}
  finally{await w.close();}
  for(const invalid of ['unknown','append']) {
    w=await workspace(()=>{globalThis.localStorage={getItem:key=>key==='alembic-settings'?JSON.stringify({canvasPromptMode:invalid}):null,setItem(){}};});
    try{assert.equal(w.v.canvasPromptMode,'chat');w.v.setCanvasPromptMode('append');assert.equal(w.v.canvasPromptMode,'chat');}finally{await w.close();}
  }
});

workspaceTest('failed native prompt context writes or annotations never run the agent',async w=>{
  const {v,mock}=w;
    await v.open('note.txt');await v.add({id:'s1',shape:'area',tag:'',area:[0,0,.5,.5],objects:[],crop:null});
    const transport=v.client.transport;
    for (const suffix of ['/file','/annotate']) {
      v.client.transport=(url,init)=>url.includes(suffix) && init?.method !== undefined ? Promise.resolve(Response.json({error:'disk_full'},{status:507})) : transport(url,init);
      v.openAsk('s1',100,100);await v.brew('Change');assert.equal(v.ask.state,'fail');assert.match(v.ask.note,/507/);
    }
    assert.equal(launches(mock).length,0);assert.deepEqual(v.chatLog,[]);assert.equal(v.nativeDraft,'');
  });

workspaceTest('real shapes write native mesh data, resize and survive reload without a highlight document',async w=>{
  const {v,mock}=w;
    mock.live.set('solid.glb',Buffer.from(pack({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]},null)));
    await v.open('solid.glb');assert.equal(v.realSupported,true);
    v.setShapeMode('real');assert.equal(v.tool,'');
    await v.add({id:'s1',tag:'',shape:'box',center:[1,2,3],size:[2,4,6],objects:[],crop:null});
    assert.equal(v.selections.length,1);assert.equal(v.selections[0].mode,'real');assert.deepEqual(v.chips,[]);
    const id=v.selections[0].solidId;
    assert.equal(readSolids(mock.live.get('solid.glb'))[0].solidId,id);
    await v.reshape({...JSON.parse(JSON.stringify(v.selections[0])),center:[5,6,7],size:[4,5,6]},true);
    const edited=readSolids(mock.live.get('solid.glb'))[0];assert.deepEqual(edited.center,[5,6,7]);assert.deepEqual(edited.size,[4,5,6]);
    const tab=v.activeTab;await v.closeTab(tab);
    mock.live.delete('.alembic/selection.json');mock.live.delete('.alembic/canvases/'+tab+'.json');
    await v.open('solid.glb');assert.equal(v.selections.length,1);assert.equal(v.selections[0].solidId,id);
    assert.deepEqual(v.selections[0].center,[5,6,7]);
    await v.remove(v.selections[0].id);assert.equal(v.selections.length,0);assert.equal(readSolids(mock.live.get('solid.glb')).length,0);
  });

workspaceTest('failed solid conversion retains the prompt volume, and conversion back removes native geometry',async w=>{
  const {v,mock}=w;
    mock.live.set('solid.gltf',Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]})));
    await v.open('solid.gltf');
    await v.add({id:'s1',tag:'',shape:'sphere',center:[0,0,0],radius:2,objects:[],crop:null});
    const original=Buffer.from(mock.live.get('solid.gltf')),transport=v.client.transport;
    v.client.transport=(url,init)=>String(url).includes('/file')&&init?.method==='PUT'&&String(url).includes('solid.gltf') ? Promise.resolve(Response.json({error:'disk_full'},{status:507})) : transport(url,init);
    await assert.rejects(v.setSelectionMode('s1','real'),/507/);
    assert.equal(v.selections[0].mode,undefined);assert.deepEqual(Buffer.from(mock.live.get('solid.gltf')),original);
    v.client.transport=transport;
    await v.setSelectionMode('s1','real');assert.equal(v.selections.length,1);assert.equal(readSolids(mock.live.get('solid.gltf')).length,1);
    await v.setSelectionMode('s1','prompt');assert.equal(v.selections[0].mode,'prompt');assert.equal(readSolids(mock.live.get('solid.gltf')).length,0);
    assert.equal(container(mock.live.get('solid.gltf')).json.scenes[0].nodes.length,0);
    await v.open('note.txt');assert.equal(v.realSupported,false);v.setShapeMode('real');assert.equal(v.shapeMode,'prompt');
  });

workspaceTest('external native solid changes refresh saved handles and stale source edits are refused',async w=>{
  const {v,mock}=w;
    mock.live.set('solid.glb',Buffer.from(pack({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]},null)));
    await v.open('solid.glb');await v.add({id:'s1',tag:'',shape:'box',center:[0,0,0],size:[1,1,1],objects:[],crop:null});
    await v.setSelectionMode('s1','real');const owned=v.selections[0].solidId;
    const newer=editSolid(mock.live.get('solid.glb'),'solid.glb',owned,{shape:'box',center:[3,4,5],size:[6,7,8]});
    mock.live.set('solid.glb',Buffer.from(newer));
    await assert.rejects(v.setSelectionMode('s1','prompt'),/model changed/);
    for(const tick of w.ticks)await tick();await v.run(async()=>{});
    assert.deepEqual(v.selections[0].center,[3,4,5]);assert.deepEqual(v.selections[0].size,[6,7,8]);
  });

test('sandbox and host terminal backends use distinct ticket channels and preserve bytes and resize frames',async()=>{
  const previous=globalThis.WebSocket;globalThis.WebSocket={OPEN:1};
  try {
    for (const agent of [undefined,'claude','codex','opencode']) {
      const socket={readyState:1,sent:[],send(data){this.sent.push(data);},close(){this.closed=true;}};
      const calls=[],output=[];let exited=0;
      const client={async shell(){calls.push('shell');return socket;},async attach(id){calls.push(id);return socket;}};
      const ready=nodeBackend(client,data=>output.push(data),()=>exited++,agent);await Promise.resolve();await Promise.resolve();
      socket.onopen();const backend=await ready;
      assert.deepEqual(calls,[agent || 'shell']);
      backend.input('hello');backend.resize(80,24);backend.cancel();await backend.invoke('command');
      assert.deepEqual(socket.sent,['hello','\0{"resize":[80,24]}\n','\x03','command\r']);
      socket.onmessage({data:new Uint8Array([65]).buffer});assert.deepEqual(output,[new Uint8Array([65])]);
      socket.onclose();assert.equal(exited,1);backend.close();assert.equal(socket.closed,true);
    }
    const web=webBackend(()=>({commands:[{name:'scene',usage:'scene <name>'}],invoke:async line=>line,cancel(){}}));
    assert.match(await web.invoke('help'),/scene <name>/);assert.equal(await web.invoke('scene sm100'),'scene sm100');
    await assert.rejects(web.invoke('claude'),/Unknown command/);web.close();
  } finally { globalThis.WebSocket=previous; }
});

test('UI keeps native panels and file shadow history without helper or command JSON controls',async()=>{
  const files=await readdir(new URL('../frontend/src/',import.meta.url));
  const source=await Promise.all(files.filter(f=>/\.(svelte|ts|js)$/.test(f)&&f!=='node.js').map(f=>readFile(new URL('../frontend/src/'+f,import.meta.url),'utf8')));
  assert.doesNotMatch(source.join('\n'),/\/fs\/|vscode:\/\/|serverFolder|httpFolder|GraphPanel|example=|config\.argv|JSON argv|Unknown example/);
  const app=await readFile(new URL('../frontend/src/App.svelte',import.meta.url),'utf8');
  for (const component of ['Shell','ChatPanel','FileTree','CanvasTabs','Areas','Handles','PromptNode','ReplayControls','MediaPreview','ShadowTree']) assert.match(app,new RegExp('<'+component+'[ >]'));
  const shell=await readFile(new URL('../frontend/src/Shell.svelte',import.meta.url),'utf8');
  assert.doesNotMatch(shell,/Resize terminal|terminal-panel/);assert.match(shell,/alembic-layout/);
});


test('pending terminal connections close on abort without leaving a host process attached',async()=>{
  let resolve;const pending=new Promise(done=>resolve=done),controller=new AbortController();
  const socket={closed:0,close(){this.closed++;}};
  const ready=nodeBackend({attach:()=>pending},()=>{},()=>{},'claude',controller.signal);
  controller.abort();resolve(socket);await assert.rejects(ready,/Closed/);assert.equal(socket.closed,1);
  const second={closed:0,close(){this.closed++;}},active=new AbortController();
  const connecting=nodeBackend({attach:async()=>second},()=>{},()=>{},'codex',active.signal);
  await Promise.resolve();await Promise.resolve();active.abort();
  await assert.rejects(connecting,/Closed/);assert.equal(second.closed,1);assert.equal(second.onopen,null);
});

workspaceTest('host agent sessions never auto-connect into the confined Codex pane',async w=>{
  const {v,mock,ticks}=w;
    const external={pid:423,agent:'codex',external:true,attachable:false,last_command:Date.now()};
    mock.sessions.set('external',external);
    mock.emit({id:1,kind:'agent.command',vm:'v1',...external});await turn();
    assert.equal(v.selectedSession,undefined);assert.equal(v.agentRows[0]?.pid,423);
    await assert.rejects(v.say('hello',[]),/sandbox terminal/);
    assert.equal(launches(mock).length,0);
    mock.emit({id:2,kind:'agent.command',vm:'other',...external,pid:999});await turn();
    assert.ok(!v.agentRows.some(row=>row.pid===999));
    mock.sessions.delete('external');for (const tick of ticks) tick();await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(v.selectedSession,undefined);assert.ok(!v.agentRows.some(row=>row.pid===423));
  });

workspaceTest('legacy provider selection cannot launch an unconfined host agent',async w=>{
  const {v,mock}=w;
    v.variant='claude';
    await assert.rejects(v.say('hello',[]),/Use the sandbox terminal/);
    assert.equal(launches(mock).length,0);
  });

workspaceTest('ready renders are offered inline without changing the current tab by default',async w=>{
  const {v,mock}=w;
  const poll=async()=>{await w.ticks[0]();await v.run(async()=>{});};
    await v.open('note.txt');const current=v.activeTab;
    assert.equal(v.autoOpenRenderTabs,false);
    mock.live.set('.alembic/preview.json',Buffer.from(JSON.stringify({version:1,id:'render-1',path:'preview.png'})));
    await poll();assert.equal(v.file,'note.txt');assert.equal(v.activeTab,current);assert.equal(v.tabs.length,1);
    assert.deepEqual(v.latestRender,{id:'render-1',path:'preview.png'});
    await v.openRenderPreview();assert.equal(v.file,'preview.png');assert.equal(v.tabs.length,2);
    await v.openRenderPreview();await poll();assert.equal(v.tabs.length,2);
});

workspaceTest('auto-open render tabs handles one transition per id, including identical stat sizes and timestamps',async w=>{
  const {v,mock}=w;
  const poll=async()=>{await w.ticks[0]();await v.run(async()=>{});};
    await v.open('note.txt');v.setAutoOpenRenderTabs(true);
    for(const id of ['render-1','render-2']) {
      mock.live.set('.alembic/preview.json',Buffer.from(JSON.stringify({version:1,id,path:'preview.png'})));
      await poll();assert.equal(v.file,'preview.png');
    }
    assert.equal(v.tabs.length,3);await poll();await poll();assert.equal(v.tabs.length,3);
    assert.equal(v.tabs[0].path,'note.txt');assert.ok(v.tabs[2].key.endsWith(':render:render-2'));
    await v.switchTab(v.tabs[0].id);await poll();assert.equal(v.file,'note.txt');assert.equal(v.tabs.length,3);
    mock.live.set('.alembic/preview.json',Buffer.from(JSON.stringify({version:1,id:'render-3',path:'not-ready.svg'})));
    await poll();assert.equal(v.file,'note.txt');
    mock.live.set('not-ready.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    await poll();assert.equal(v.file,'not-ready.svg');assert.equal(v.tabs.length,4);
});

test('auto-open render preference persists independently of prompt mode',async()=>{
  let stored=JSON.stringify({canvasPromptMode:'chat',unrelated:1});
  let w=await workspace(()=>{globalThis.localStorage={getItem:key=>key==='alembic-settings'?stored:null,setItem:(key,value)=>{if(key==='alembic-settings')stored=value;}};});
  try{w.v.setAutoOpenRenderTabs(true);assert.deepEqual(JSON.parse(stored),{canvasPromptMode:'chat',unrelated:1,autoOpenRenderTabs:true});}finally{await w.close();}
  w=await workspace(()=>{globalThis.localStorage={getItem:key=>key==='alembic-settings'?stored:null,setItem(){}};});
  try{assert.equal(w.v.autoOpenRenderTabs,true);assert.equal(w.v.canvasPromptMode,'chat');}finally{await w.close();}
});

workspaceTest('right-click prompting creates a point context without adding solid geometry',async w=>{
  const {v,mock}=w;
    const source=pack({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]},null);
    mock.live.set('scene.glb',source);await v.open('scene.glb');
    v.setShapeMode('real');assert.equal(v.tool,'');
    v.openMenu('',150,150);await v.promptMenu();
    assert.equal(v.selections.length,1);assert.equal(v.selections[0].shape,'pick');assert.equal(v.selections[0].mode,undefined);
    assert.deepEqual(v.selections[0].objects,[{node:0,name:'Triangle'}]);assert.equal(v.ask.id,v.selections[0].id);
    assert.equal(v.tool,'');assert.deepEqual(mock.live.get('scene.glb'),source);
    v.ask=null;v.openMenu(v.selections[0].id,160,160);await v.promptMenu();assert.equal(v.selections.length,1);
  });

workspaceTest('placement disarms synchronously so rapid clicks cannot enqueue duplicate solids',async w=>{
  const {v,mock,viewer}=w;
    mock.live.set('scene.glb',pack({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]},null));
    await v.open('scene.glb');v.setShapeMode('real');assert.equal(v.tool,'');
    v.tool='box';viewer.place([0,0,0],1,null);assert.equal(v.tool,'');
    viewer.place([2,0,0],1,null);viewer.place([3,0,0],1,null);await v.run(async()=>{});
    assert.equal(readSolids(mock.live.get('scene.glb')).length,1);assert.equal(v.tool,'');assert.equal(v.error,'');
  });

workspaceTest('canvas views stay in one tab, preserve per-view context and send the scene graph with prompts',async w=>{
  const {v,mock}=w;
    const manifest={format:'alembic.canvas',version:1,title:'Castle',views:['model','sprite'],defaultView:'model',nodes:[
      {id:'model',label:'3D',path:'draft.gltf',inputs:[]}, {id:'sprite',label:'Sprite',path:'scene.svg',inputs:[]}]};
    const bytes=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Keep castle'}]}));
    mock.live.set('draft.gltf',bytes);mock.live.set('Castle.canvas',Buffer.from(JSON.stringify(manifest)));
    await v.open('Castle.canvas');assert.equal(v.documentPath,'Castle.canvas');assert.equal(v.file,'draft.gltf');assert.equal(v.kind,'model');
    await v.add({id:'castle-point',tag:'saved',shape:'sphere',center:[0,0,0],radius:1,objects:[],crop:null});
    await v.switchCanvasView('sprite');assert.equal(v.file,'scene.svg');assert.equal(v.kind,'svg');assert.equal(v.tabs.length,1);assert.equal(v.selections.length,0);
    await v.switchCanvasView('model');assert.equal(v.selections[0].id,'castle-point');assert.equal(v.tabs.length,1);
    v.variant='codex';v.setCanvasPromptMode('chat');
    v.openMenu('castle-point',100,100);await v.promptMenu();await v.brew('Add gameplay here');
    const detail=mock.writes.findLast(x=>x.path.startsWith('.alembic/selections/'));
    const context=JSON.parse(mock.live.get(detail.path));assert.equal(context.file,'draft.gltf');assert.equal(context.canvas.path,'Castle.canvas');assert.equal(context.canvas.view,'model');assert.equal(context.canvas.nodes.length,2);
    assert.match(mock.annotations.at(-1).text,/Node Castle\.canvas; view 3D \(draft\.gltf\); source draft\.gltf/);
    assert.deepEqual(mock.live.get('draft.gltf'),bytes);assert.equal(v.chatLog.length,0);assert.equal(launches(mock).length,0);
    assert.match(mock.prompts.at(-1),/Node Castle\.canvas; view 3D \(draft\.gltf\); source draft\.gltf/);
    await v.open('note.txt');await v.switchTab(v.tabs.find(t=>t.path==='Castle.canvas').id);assert.equal(v.canvasView,'model');assert.equal(v.documentPath,'Castle.canvas');
    manifest.nodes.push({id:'vector',label:'Vector',path:'scene.svg',inputs:[]});manifest.views.push('vector');mock.live.set('Castle.canvas',Buffer.from(JSON.stringify(manifest)));
    await w.ticks[0]();await v.run(async()=>{});assert.equal(v.canvas.views.length,3);assert.equal(v.tabs.length,2);assert.equal(v.tool,'');
  });


workspaceTest('minimal layout reads the scene without starting agent sessions or writing highlights',async w=>{
  const {v,mock}=w;
    assert.equal(v.minimal,true);assert.equal(v.file,'draft.gltf');await v.open('draft.gltf');assert.equal(v.kind,'model');assert.equal(v.realSupported,false);
    v.openMenu('',100,100);assert.equal(v.menu,null);
    await v.open('scene.svg');await v.switchTab(v.tabs[0].id);
    assert.equal(mock.writes.length,0);assert.equal(mock.annotations.length,0);
    assert.ok(!mock.calls.some(c=>/\/(agents|sessions|launch|events)$/.test(c.path)));
    await assert.rejects(v.say('edit here',[]),/sandbox terminal/);
  }, mock=>{location.search='?layout=minimal&file=draft.gltf';mock.live.set('draft.gltf',Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]})));});


folderTest('parallel file stats share one directory listing and local writes invalidate it',async ({mock,client,folder})=>{
  await Promise.all(['note.txt','scene.svg','preview.png'].map(path=>folder.stat(path)));
  assert.equal(mock.calls.filter(c=>c.path.endsWith('/tree')).length,2); // One cursor traversal.
  await folder.write('added.txt',Buffer.from('new'));assert.equal((await folder.stat('added.txt')).size,3);
  await assert.rejects(folder.stat('late.txt'),/Missing/);
  mock.live.set('late.txt',Buffer.from('ready'));assert.equal((await folder.stat('late.txt')).size,5);
});

folderTest('direct client writes, restore and external invalidation refresh folder caches immediately',async ({mock,client,folder})=>{
  await folder.list();
  await client.write('new.txt',Buffer.from('new'));
  assert.ok((await folder.list()).some(row=>row.name==='new.txt'));
  await client.write('.alembic/tree.txt',Buffer.from(JSON.stringify({version:1,hidden:['new.txt']})));
  assert.ok(!(await folder.list()).some(row=>row.name==='new.txt'));
  await client.restore('1'.repeat(40));
  assert.ok(!(await folder.entries()).some(row=>row.name==='new.txt'));
  mock.live.set('outside.txt',Buffer.from('outside'));
  folder.invalidate();
  assert.ok((await folder.list()).some(row=>row.name==='outside.txt'));
});

test('idle large models avoid repeated downloads while timestamp-preserving and normal edits still refresh',async()=>{
  const nativeNow=Date.now;let clock=nativeNow();Date.now=()=>clock;
  const bytes=marker=>Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[],extras:{marker,padding:'x'.repeat(300000)}}));
  const w=await workspace(mock=>mock.live.set('large.gltf',bytes('A'))),{v,mock}=w;
  try {
    await v.open('large.gltf');const before=window.__alembic.selection().sha256;mock.calls.length=0;
    for(let i=0;i<6;i++){clock+=1000;await w.ticks[0]();}
    const reads=()=>mock.calls.filter(c=>c.method==='GET'&&c.path.endsWith('/file')&&c.query.path==='large.gltf').length;
    assert.equal(reads(),0);
    mock.live.set('large.gltf',bytes('B'));clock+=5000;await w.ticks[0]();assert.equal(reads(),1);assert.notEqual(window.__alembic.selection().sha256,before);
    mock.live.set('large.gltf',Buffer.concat([bytes('B'),Buffer.from(' ')]));clock+=1000;await w.ticks[0]();assert.equal(reads(),2);
  }finally{await w.close();Date.now=nativeNow;}
});

test('background polling cannot hold up UI actions or overwrite a newly selected view',async()=>{
  const w=await workspace(),{v,mock}=w;let release;
  try {
    await v.open('note.txt');const original=mock.fetch;let reached;
    const waiting=new Promise(resolve=>reached=resolve);
    mock.fetch=(url,init)=>{const u=new URL(url);if(u.pathname.endsWith('/file')&&u.searchParams.get('path')==='note.txt'){reached();return new Promise(resolve=>release=()=>original(url,init).then(resolve));}return original(url,init);};
    const poll=w.ticks[0]();await waiting;
    let opened=false;const opening=v.run(()=>v.open('scene.svg')).then(()=>{opened=true;});
    for(let i=0;i<10&&!opened;i++)await turn();
    assert.ok(opened,'UI blocked by background read');assert.equal(v.file,'scene.svg');
    release();await opening;await poll;assert.equal(v.file,'scene.svg');
  }finally{release?.();await w.close();}
});

workspaceTest('retryable publication reads preserve the visible view and do not block file actions',async w=>{
  const {v,mock}=w;
    await v.open('note.txt');const original=mock.fetch;
    let release,arrived;const waiting=new Promise(resolve=>arrived=resolve);
    mock.fetch=(url,init)=>{
      const u=new URL(url);
      if(u.pathname.endsWith('/file')&&u.searchParams.get('path')==='note.txt'){
        arrived();return new Promise(resolve=>release=()=>resolve(Response.json({error:'publication_in_progress',retryable:true},{status:503})));
      }
      return original(url,init);
    };
    const polling=w.ticks[0]();await waiting;
    release();await polling;
    assert.equal(v.file,'note.txt');assert.equal(v.text,'AFTER');assert.equal(v.error,'');
    mock.fetch=original;
    let opened=false;await v.run(async()=>{await v.open('scene.svg');opened=true;});
    assert.equal(opened,true);assert.equal(v.file,'scene.svg');
  });

workspaceTest('typed package opens as its own tab and follows manifest edits without a canvas wrapper', async w => {
  const {v,mock}=w;
  const manifest=entry=>Buffer.from(JSON.stringify({format:'alembic.node',version:1,entry,dependencies:{}}));
  mock.live.set('weapon.i3d/manifest.json',manifest('first.txt'));
  mock.live.set('weapon.i3d/first.txt',Buffer.from('original source'));
  mock.live.set('weapon.i3d/second.txt',Buffer.from('changed view'));
  await v.open('weapon.i3d');
  assert.equal(v.documentPath,'weapon.i3d'); assert.equal(v.tabs.at(-1).path,'weapon.i3d');
  assert.equal(v.file,'weapon.i3d/first.txt'); assert.equal(v.text,'original source');
  mock.live.set('weapon.i3d/manifest.json',manifest('second.txt'));
  await w.ticks[0](); await v.run(async()=>{});
  assert.equal(v.documentPath,'weapon.i3d'); assert.equal(v.text,'changed view');
  await v.open('note.txt'); await v.switchTab(v.tabs.find(tab=>tab.path==='weapon.i3d').id);
  assert.equal(v.text,'changed view'); assert.equal(v.documentPath,'weapon.i3d');
  assert.ok(!mock.calls.some(c=>c.path.includes('weapon.i3d.canvas')));
});

workspaceTest('opening a known node directory costs one listing and one descriptor read, never probing the absent one',async w=>{
  const {v,mock}=w;
  const manifest=entry=>Buffer.from(JSON.stringify({format:'alembic.node',version:1,entry,dependencies:{}}));
  const tree=path=>mock.calls.filter(c=>c.path.endsWith('/tree')&&c.query.path===path).length;
  const reads=path=>mock.calls.filter(c=>c.method==='GET'&&c.path.endsWith('/file')&&c.query.path===path).length;
  mock.live.set('scene.i3d/.node.txt',manifest('body.txt'));
  mock.live.set('scene.i3d/body.txt',Buffer.from('node body'));
  mock.live.set('legacy.i3d/manifest.json',manifest('old.txt'));
  mock.live.set('legacy.i3d/old.txt',Buffer.from('legacy body'));
  mock.calls.length=0;
  await v.open('scene.i3d',true);
  assert.equal(v.documentPath,'scene.i3d'); assert.equal(v.text,'node body');
  assert.equal(tree(''),0); assert.equal(tree('scene.i3d'),1);      // no parent re-listing for a known directory
  assert.equal(reads('scene.i3d/.node.txt'),1); assert.equal(reads('scene.i3d/manifest.json'),0);
  await v.open('legacy.i3d',true);
  assert.equal(v.documentPath,'legacy.i3d'); assert.equal(v.text,'legacy body');
  assert.equal(tree(''),0); assert.equal(tree('legacy.i3d'),1);
  assert.equal(reads('legacy.i3d/manifest.json'),1); assert.equal(reads('legacy.i3d/.node.txt'),0);
});

test('node rows open on click while a distinct disclosure expands their sources',async()=>{
  const tree=await readFile(new URL('../frontend/src/FileTree.svelte',import.meta.url),'utf8');
  assert.match(tree,/open: \(path: string, directory\?: boolean\) => void/);
  assert.match(tree,/onexpand=\{node \? \(\) => expanded\[path\] = !expanded\[path\] : undefined\}/);
  assert.match(tree,/onclick=\{\(\) => entry\.directory && !node \? expanded\[path\] = !expanded\[path\] : open\(path, entry\.directory\)\}/);
  const row=await readFile(new URL('../frontend/src/Row.svelte',import.meta.url),'utf8');
  assert.match(row,/class="disclosure"/);
  assert.match(row,/class="node-open"/);
  const app=await readFile(new URL('../frontend/src/App.svelte',import.meta.url),'utf8');
  assert.match(app,/open=\{\(path, directory\) => \{ void run\(\(\) => open\(path, directory\)\); \}\}/);
});

test('saved states and shadow history label with names, not raw hashes, and bound the history window',async()=>{
  const saves=await readFile(new URL('../frontend/src/NodeSaves.svelte',import.meta.url),'utf8');
  assert.doesNotMatch(saves,/short\(/);                          // no hash prefixes in primary labels
  assert.match(saves,/Saved state \{index \+ 1\}/);              // ordinal history labels
  assert.doesNotMatch(saves,/title=\{record\.result\.state\}/);  // the raw state is not a default tooltip
  const graph=await readFile(new URL('../frontend/src/ShadowGraph.svelte',import.meta.url),'utf8');
  assert.doesNotMatch(graph,/\.slice\(0, ?\d+\)/);               // run/version cards show title/actor/time, not ids
  const shadow=await readFile(new URL('../frontend/src/ShadowTree.svelte',import.meta.url),'utf8');
  assert.doesNotMatch(shadow,/Snapshot \$\{selected\.slice/);    // the version heading names the version, not its hash
  assert.match(shadow,/client\.log\(runLimit\)/);                // the history read follows the chosen window
  assert.match(shadow,/option value=\{500\}/);                   // the full window stays an explicit choice
});


workspaceTest('stream renders fail visibly while legacy view metadata remains readable',async w=>{
  const {v,mock}=w;
    mock.live.set('old.i3d/.node.txt',Buffer.from(JSON.stringify({format:'alembic.node',version:1,entry:'scene.stream',dependencies:{}})));
    mock.live.set('old.i3d/view.txt',Buffer.from('view-index\t1\ndefault\tlive\nview\tlive\tgodot\tscene.stream\naction\tlive\tFire\tkey:f\n'));
    mock.live.set('old.i3d/scene.stream',Buffer.from('{}'));
    await v.run(()=>v.open('old.i3d',true));
    assert.match(v.error,/unsupported for now/);assert.equal(v.kind,'');
    assert.equal(mock.calls.filter(c=>c.path.endsWith('/call')).length,0,'No retired native CLI is launched');
  });

folderTest('tree hides only explicitly identified infrastructure and package descriptors',async ({mock,client,folder})=>{
  mock.live.set('.alembic/tree.txt',Buffer.from(JSON.stringify({version:1,hidden:['machinery','nested/private']})));
  mock.live.set('machinery/data.txt',Buffer.from('internal'));
  mock.live.set('tools/user.txt',Buffer.from('user'));
  mock.live.set('nested/private/data.txt',Buffer.from('internal'));
  mock.live.set('nested/public.txt',Buffer.from('user'));
  mock.live.set('scene.i3d/.node.txt',Buffer.from('{}'));
  mock.live.set('scene.i3d/manifest.json',Buffer.from('{}'));
  mock.live.set('scene.i3d/user.json',Buffer.from('{}'));
  mock.live.set('scene.i3d/view.stream',Buffer.from('{}'));
  mock.live.set('scene.i3d/weapon.gd.uid',Buffer.from('uid://123'));
  mock.live.set('standalone.stream',Buffer.from('{}'));
  const root=await folder.list();
  assert.ok(!root.some(e=>e.name==='machinery'));
  assert.ok(root.some(e=>e.name==='tools'));
  assert.deepEqual((await folder.list('nested')).map(e=>e.name),['public.txt']);
  assert.deepEqual((await folder.list('scene.i3d')).map(e=>e.name),['user.json']);
  assert.deepEqual((await folder.list('scene.i3d',true)).map(e=>e.name),['user.json','view.stream','weapon.gd.uid']);
  assert.ok((await folder.list()).some(e=>e.name==='standalone.stream'));
});

workspaceTest('delivery keeps brewing until its project receipt, retaining captured history', async ({v,mock}) => {
  v.variant = 'codex';
  await v.open('note.txt');
  await v.add({id:'finished',shape:'area',tag:'',area:[0,0,.5,.5],objects:[],crop:null});
  let delivered;
  v.bindTerminalPrompt(async line => { delivered = line; });
  v.openAsk('finished',100,100);
  await v.brew('Keep this context');
  assert.match(delivered,/Keep this context/);
  assert.equal(v.ask.state,'brew');
  assert.equal(v.promptNodes.length,1);
  const details = delivered.match(/details: ([^)]+)\)/)[1];
  mock.live.set(details.replace(/\.json$/, '.done'), Buffer.from('done\n'));
  for (let i=0;i<100&&v.ask.state==='brew';i++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(v.ask.state,'done');
  assert.equal(v.promptNodes.length,0);
  assert.equal(v.visible.length,0);
  assert.equal(v.selections.length,1);
  assert.ok(mock.writes.some(write=>write.path.startsWith('.alembic/selections/')));
  v.openAsk('finished',100,100);
  assert.equal(v.promptNodes.length,1);
  assert.equal(v.visible.length,1);
});

workspaceTest('failed prompt stays visible for retry', async ({v}) => {
  v.variant = 'codex';
  await v.open('note.txt');
  await v.add({id:'retry',shape:'area',tag:'',area:[0,0,.5,.5],objects:[],crop:null});
  v.bindTerminalPrompt(async () => { throw new Error('Delivery failed'); });
  v.openAsk('retry',100,100);
  await v.brew('Try this');
  assert.equal(v.ask.state,'fail');
  assert.equal(v.promptNodes.length,1);
  assert.equal(v.visible.length,1);
});

for (const grant of ['', 'interaction\tapp\tio_lock\tfalse\n', 'interaction\tapp\tio_lock\ttrue\n']) workspaceTest(`light iframe owns IO without an authored binding (grant: ${grant.trim() || 'absent'})`, async ({v,mock,events}) => {
  mock.live.set('plain.iframe/.node.txt',Buffer.from(JSON.stringify({format:'alembic.node',version:1,entry:'index.html',dependencies:{}})));
  mock.live.set('plain.iframe/exports.txt',Buffer.from('exports-index\t1\nrender\tapp\tapp\tindex.html\n'+grant));
  mock.live.set('plain.iframe/playbacks.txt',Buffer.from('playbacks-index\t2\n'));
  mock.live.set('plain.iframe/index.html',Buffer.from('<!doctype html><button>Ordinary app</button>'));
  await v.open('plain.iframe');
  assert.equal(v.surface.lightIframe,true);
  assert.equal(new URL(v.frame).hash.includes('handshake=light-iframe'),true);
  assert.equal(v.webReady,null);
  assert.equal(v.interactionState.configured,true);
  assert.equal(v.interactionPermissions.io_lock,true);
  await v.toggleInteraction('io_lock');
  assert.equal(v.interactionState.io_lock,true);
  const target=new class {postMessage(){}}();
  v.frameEl=new class {contentWindow=target;focus(){}}();
  const message=new Event('message');
  Object.assign(message,{source:target,origin:new URL(v.frame).origin,data:{
    type:'alembic.web.interaction.result',session:new URLSearchParams(new URL(v.frame).hash.slice(1)).get('session'),
    id:null,ok:true,state:{io_lock:false,configured:false,capabilities:{io_lock:true}}
  }});
  events.dispatchEvent(message);
  assert.equal(v.interactionState.configured,true,'Optional app binding cannot disable host IO on blur');
  assert.equal(v.interactionState.io_lock,true);
  await v.toggleInteraction('io_lock');
  assert.equal(v.interactionState.io_lock,false);
  await v.toggleInteraction('io_lock');
  v.releaseInteraction();
  assert.equal(v.interactionState.io_lock,false);
  await assert.rejects(v.toggleInteraction('screen_lock'),/does not allow/);
  assert.equal(v.error,'');
});

for (const action of ['closePrompt', 'remove']) workspaceTest(`late delivery failure preserves ${action}`, async ({v,mock}) => {
  v.variant = 'codex'; await v.open('note.txt');
  await v.add({id:'deleted',shape:'area',tag:'',area:[0,0,.5,.5],objects:[],crop:null});
  let reject, entered;
  const waiting = new Promise(resolve => entered = resolve);
  v.bindTerminalPrompt(() => { entered(); return new Promise((_, fail) => reject = fail); });
  v.openAsk('deleted',100,100);
  const sending = v.brew('Keep delivering'); await waiting;
  await v[action]('deleted'); reject(new Error('Delivery failed')); await sending;
  assert.equal(v.promptNodes.length,0);
  const saved = JSON.parse(mock.live.get('.alembic/selection.json'));
  assert.equal(saved.pending.length,0);
  assert.ok(saved.prompts.every(node => node.hidden));
});

workspaceTest('legacy canvas snapshots without prompt state or timestamps still load', async ({v}) => {
  await v.open('note.txt'); assert.equal(v.selections[0].tag,'legacy');
}, mock => {
  for (const [canvasId,file] of [['legacy','note.txt'],['other','scene.svg']])
    mock.live.set(`.alembic/canvases/${canvasId}.json`,Buffer.from(JSON.stringify({version:1,canvasId,file,
      selections:[{id:'s1',shape:'area',tag:'legacy',area:[0,0,.5,.5],objects:[],crop:null}]})));
});
