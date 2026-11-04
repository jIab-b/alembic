import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {preparePreview,runtimeExecutor,previewOrigin,discoverPreview} from '../frontend/src/preview.js';
const root = new URL('../frontend/public/assets/',import.meta.url);
class Channel {
  constructor(){
    const ports=[{close(){}},{close(){}}];
    ports.forEach((port,i)=>{port.postMessage=data=>queueMicrotask(()=>ports[1-i].onmessage?.({data}));});
    [this.port1,this.port2]=ports;
  }
}
const policy="default-src 'none'; script-src 'self'; frame-ancestors 'none'";
async function serviceWorker(files = new Map(), host = '', lightIframe = true) {
  const handlers={}, reads=[];
  const client={url:'http://node.test/assets/play/index.html',postMessage(data,ports){
    if(data.type==='alembic.session')ports[0].postMessage({session:'s1',lightIframe});
    else{reads.push(data.path);const bytes=files.get(data.path);ports[0].postMessage(bytes?{bytes}:{error:'Missing'});}
  }};
  const self={location:new URL('http://node.test/assets/preview-sw.js'+(host?'?'+new URLSearchParams({host}):'')),registration:{scope:'http://node.test/assets/'},addEventListener(name,fn){handlers[name]=fn;},clients:{get:async id=>id==='app'?{url:'http://node.test/assets/play/app/s1/index.html'}:client,matchAll:async()=>[client],claim:async()=>{}},skipWaiting:async()=>{}};
  runInNewContext(await readFile(new URL('preview-sw.js',root),'utf8'),{self,URL,Headers,Response,TextDecoder,MessageChannel:Channel,setTimeout,clearTimeout,fetch:async()=>new Response('PACKAGED',{headers:{'Content-Security-Policy':policy}})});
  return {reads,async request(path,clientId=''){let result;handlers.fetch({clientId,request:new Request('http://node.test'+path),respondWith(value){result=Promise.resolve(value);}});return result;}};
}

test('packaged viewers are under the node static assets route; the bridge has no inline scripts',async()=>{
  for (const path of ['preview-sw.js','play/index.html','play/bridge.js','play/app-tools.js']) await access(new URL(path,root));
  assert.deepEqual(JSON.parse(await readFile(new URL('../../dist/assets/runtimes/manifest.json',root),'utf8')),[]);
  const html=await readFile(new URL('play/index.html',root),'utf8');
  assert.match(html,/<script type="module" src="bridge.js"><\/script>/);
  assert.ok([...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].every(match=>!match[1].trim()));
  const worker=await readFile(new URL('../../dist/assets/runtimes/worker-host.js',root),'utf8');
  assert.match(worker,/base: new URL\('\.\.\/', source\)/);assert.match(worker,/event.source !== parent/);
});

test('only a distinct preview origin enables same-origin app resources',async()=>{
  const files=new Map([['index.html',new TextEncoder().encode('<html>App</html>')]]);
  for(const [host,isolated] of [['http://controller.test',true],['http://node.test',false],['invalid',false],['http://controller.test/path',false]]){
    const response=await (await serviceWorker(files,host)).request('/assets/play/app/s1/index.html');
    assert.equal(response.headers.get('Content-Security-Policy').includes('allow-same-origin'),isolated);
  }
});

test('preview discovery accepts only a separate loopback origin for this controller and workspace',async()=>{
  assert.equal(previewOrigin('http://127.0.0.1:4001','http://127.0.0.1:4000'),'http://127.0.0.1:4001');
  for(const value of ['http://127.0.0.1:4000','https://example.test','http://user@localhost:4001','http://localhost:4001/path','http://localhost:4001/?token=secret'])
    assert.throws(()=>previewOrigin(value,'http://127.0.0.1:4000'),/Invalid preview/);
  const previous=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json({controller:'http://127.0.0.1:4000',workspaces:{w1:'http://127.0.0.1:4001'}});
    assert.equal(await discoverPreview({workspace:'w1'},'/manifest','http://127.0.0.1:4000'),'http://127.0.0.1:4001');
    assert.equal(await discoverPreview({workspace:'w2'},'/manifest','http://127.0.0.1:4000'),'');
    assert.equal(await discoverPreview({workspace:'w1'},'/manifest','http://localhost:4000'),'');
  }finally{globalThis.fetch=previous;}
});

test('trusted runtime frames relax only their own frame and WASM restrictions',async()=>{
  const sw=await serviceWorker();
  for(const path of ['/assets/play/index.html','/assets/runtimes/worker-host.html','/assets/runtimes/arch-sim/assets/worker.js']){
    const response=await sw.request(path);assert.equal(await response.text(),'PACKAGED');
    assert.equal(response.headers.get('Content-Security-Policy'),"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; frame-ancestors 'self'");
  }
  assert.equal(await sw.request('/assets/main.js'),undefined);assert.equal(await sw.request('/w/w1/file'),undefined);
});

test('app file requests pass through the owning bridge; HTML is isolated and tools are inserted',async()=>{
  const sw=await serviceWorker(new Map([
    ['index.html',new TextEncoder().encode('<!doctype html><html><head><title>App</title></head><body>OK</body></html>')],
    ['draw.js',new TextEncoder().encode('draw();')]
  ]));
  const response=await sw.request('/assets/play/app/s1/index.html'),html=await response.text();
  assert.match(html,/^<!doctype html>/);assert.match(html,/<head><script src="http:\/\/node.test\/assets\/play\/app-tools.js"><\/script>/);
  assert.equal(response.headers.get('Content-Security-Policy'),'sandbox allow-scripts allow-forms allow-pointer-lock');
  assert.doesNotMatch(response.headers.get('Content-Security-Policy'),/allow-same-origin/);
  const script=await sw.request('/assets/play/app/s1/draw.js');assert.equal(await script.text(),'draw();');
  assert.equal(script.headers.get('Content-Type'),'text/javascript');assert.equal(script.headers.get('Access-Control-Allow-Origin'),'*');
  assert.deepEqual(sw.reads,['index.html','draw.js']);
  assert.equal((await sw.request('/assets/play/app/other/index.html')).status,404);
  assert.equal((await sw.request('/assets/play/app/s1/.secret')).status,400);
  assert.equal((await sw.request('/assets/play/app/s1/bad%ZZ')).status,400);
});

test('preview registration waits for activation and does not register twice',async()=>{
  const previous=globalThis.navigator,worker=new EventTarget();worker.state='installing';let registrations=0;
  Object.defineProperty(globalThis,'navigator',{value:{serviceWorker:{async register(){registrations++;return {installing:worker};}}},configurable:true});
  try{
    const first=preparePreview('http://node.test/assets/preview-test-sw.js');await Promise.resolve();
    worker.state='activated';worker.dispatchEvent(new Event('statechange'));await first;
    await preparePreview('http://node.test/assets/preview-test-sw.js');assert.equal(registrations,1);
  }finally{Object.defineProperty(globalThis,'navigator',{value:previous,configurable:true});}
});

test('closing a runtime before initialization prevents later commands',async()=>{
  const execute=runtimeExecutor('http://node.test/assets/runtimes/arch-sim/assets/worker.js','http://node.test/assets/preview-sw.js');
  execute.close();await assert.rejects(execute({}),/Closed/);
});


test('runtime executor handshakes with a trusted frame and closes pending work',async()=>{
  const previous = new Map(), sent = [], worker = 'http://node.test/assets/runtimes/arch-sim/assets/worker.js';
  const set = (key,value) => { previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true}); };
  let removed=false;
  set('navigator',{serviceWorker:{register:async()=>({active:{}})}});set('MessageChannel',Channel);
  set('document',{createElement(){return {contentWindow:{postMessage(message,origin,ports){
    assert.deepEqual(message,{type:'alembic.runtime',worker});assert.equal(origin,'http://node.test');
    const port=ports[0];port.onmessage=({data})=>{sent.push(data);if(data.request!==null)port.postMessage({id:data.id,value:data.request});};
    port.postMessage({ready:true});
  }},remove(){removed=true;}};},body:{append(frame){queueMicrotask(()=>frame.onload());}}});
  try{
    const execute=runtimeExecutor(worker,'http://node.test/assets/runtime-test-sw.js');
    assert.deepEqual(await execute({graph:{events:[]}}),{graph:{events:[]}});
    const pending=execute(null);while(sent.length<2)await Promise.resolve();execute.close();
    await assert.rejects(pending,/Closed/);assert.equal(removed,true);await assert.rejects(execute({}),/Closed/);
  }finally{for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

test('light iframe root-relative assets use the requesting app session, including paths outside worker scope',async()=>{
 const sw=await serviceWorker(new Map([
  ['assets/site.js',new TextEncoder().encode('APP_BOOTED')],
  ['icons/logo.svg',new TextEncoder().encode('<svg/>')]
 ]));
 const script=await sw.request('/assets/site.js','app');
 assert.equal(script.status,302);
 assert.equal(new URL(script.headers.get('Location')).pathname,'/assets/play/app/s1/assets/site.js');
 assert.equal(await (await sw.request(new URL(script.headers.get('Location')).pathname)).text(),'APP_BOOTED');
 const icon=await sw.request('/icons/logo.svg','app');
 assert.equal(await (await sw.request(new URL(icon.headers.get('Location')).pathname)).text(),'<svg/>');
 assert.match(await (await sw.request('/assets/play/app/s1/assets/missing.js')).text(),/Cannot load app file assets\/missing.js/);
 assert.equal(await sw.request('/assets/play/dom-capture.js','app'),undefined);
 const strict=await serviceWorker(new Map(),' ',false);
 assert.equal(await (await strict.request('/assets/site.js','app')).text(),'PACKAGED');
});
