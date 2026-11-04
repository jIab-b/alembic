import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
const require=createRequire(import.meta.url);
const core=new URL('../frontend/node_modules/@babylonjs/core/',import.meta.url);
const html=`<!doctype html><html><body><canvas id="scene" width="320" height="240" tabindex="0"></canvas><div id="hud" hidden>Gameplay HUD</div><script type="module" src="main.js"></script></body></html>`;
const app=`import * as BABYLON from './vendor/babylon.js';
import {bindInteraction} from '/assets/play/interaction.js';
const canvas=document.querySelector('#scene'),engine=new BABYLON.Engine(canvas,true),scene=new BABYLON.Scene(engine);
const camera=new BABYLON.ArcRotateCamera('inspect',-Math.PI/2,.12,8,BABYLON.Vector3.Zero(),scene);
camera.attachControl(canvas,true);new BABYLON.HemisphericLight('light',new BABYLON.Vector3(0,1,0),scene);
const actor=BABYLON.MeshBuilder.CreateBox('actor',{},scene),held=new Set();
window.probe={camera,actor,plays:0,resets:0,frames:0,following:false};
const binding=bindInteraction({io_lock:on=>{document.querySelector('#hud').hidden=!on;if(!on)held.clear()},
 release:()=>held.clear()});
probe.binding=binding;await binding.ready;
addEventListener('keydown',event=>{if(binding.state.io_lock&&event.code==='KeyW')held.add('forward')});addEventListener('keyup',()=>held.clear());
canvas.addEventListener('click',()=>{if(binding.state.io_lock)canvas.requestPointerLock()});
engine.runRenderLoop(()=>{probe.frames++;if(binding.state.io_lock&&held.has('forward'))actor.position.z+=Math.min(engine.getDeltaTime()/1000,.1)*4;scene.render()});
addEventListener('message',async event=>{
 if(event.source!==parent||event.origin!==location.origin)return;
 const {type,id,scenario}=event.data||{};
 if(type==='alembic.web.play'){if(scenario!=='arena')return parent.postMessage({type:'alembic.web.result',id,ok:false,error:'Unknown scenario'},location.origin);probe.plays++;parent.postMessage({type:'alembic.web.result',id,ok:true},location.origin)}
 if(type==='alembic.web.reset'){probe.resets++;parent.postMessage({type:'alembic.web.result',id,ok:true},location.origin)}
});
parent.postMessage({type:'alembic.web.ready',renders:['web'],scenarios:['arena'],exports:['fire'],controls:['orbit','pan','zoom','play','reset','lock','escape'],interaction:binding.state},location.origin);`;
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+s.address().port)));
test('isolated Babylon separates playback, IO and following camera through actual runtime hooks', {timeout:60000}, async t=>{
 let playwright;try{playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright')}catch(e){if(e.code==='MODULE_NOT_FOUND'){t.skip('Playwright unavailable');return}throw e}
 let origin,preview,context,helper,lines;const reads=[];
 const controller=createServer(async(req,res)=>{
  let body='',type='text/javascript';
  if(req.url==='/') {type='text/html';body='<script type="module" src="/harness.js"></script>'}
  else if(req.url==='/harness.js')body=`const frame=document.createElement('iframe');window.received=[];window.send=(type,id,extra={})=>frame.contentWindow.postMessage({type,id,session:'web-test',...extra},${JSON.stringify(preview)});
   addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.origin!==${JSON.stringify(preview)})return;const d=e.data;if(d.type==='alembic.read'){window.received.push(d.path);const r=await fetch('/file?'+encodeURIComponent(d.path));const bytes=r.ok?await r.arrayBuffer():null;e.source.postMessage({type:'alembic.file',id:d.id,...(bytes?{bytes}:{error:'Missing'})},${JSON.stringify(preview)},bytes?[bytes]:[])}else window.received.push(d)});
   frame.src=${JSON.stringify(preview)}+'/assets/play/index.html#'+new URLSearchParams({host:location.origin,session:'web-test',entry:'web/index.html'});document.body.append(frame);`;
  else if(req.url.startsWith('/file?')) {
   const path=decodeURIComponent(req.url.slice(6));reads.push(path);
   body=path==='web/index.html'?html:path==='web/main.js'?app:
    path==='web/vendor/babylon.js'?'export * from "../core/index.js";':
    path.startsWith('web/core/')&&!path.includes('..')?await readFile(new URL(path.slice(9),core)):'';
   if(!body){res.writeHead(404);res.end();return}
   type=path.endsWith('.html')?'text/html':'text/javascript';
  }
  else {res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
 });
 try{
  origin=await listen(controller);
  helper=spawn('python3',['-u','-c',`import sys,threading\nfrom preview_server import preview_http_server\ns=preview_http_server(sys.argv[1],sys.argv[2]);print('http://127.0.0.1:'+str(s.server_port),flush=True)\nthreading.Thread(target=lambda:(sys.stdin.read(),s.shutdown()),daemon=True).start();s.serve_forever()`,new URL('../frontend/public/assets/',import.meta.url).pathname,origin],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','inherit']});
  lines=createInterface({input:helper.stdout});[preview]=await once(lines,'line');
  context=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await context.newPage();await page.goto(origin);
  const inside=page.frameLocator('iframe').frameLocator('iframe');await inside.locator('canvas').waitFor();
  await page.waitForFunction(()=>window.received.some(x=>x?.type==='alembic.web.ready'));
  await page.evaluate(()=>window.postMessage({type:'alembic.web.ready',renders:['spoof']},location.origin));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>window.received.filter(x=>x?.type==='alembic.web.ready').length),1);
  assert.ok(reads.includes('web/vendor/babylon.js'));
  await inside.locator('canvas').evaluate(async()=>{while(probe.frames<3)await new Promise(resolve=>requestAnimationFrame(resolve))});
  assert.ok(await inside.locator('canvas').evaluate(()=>probe.camera.position.y>7&&probe.camera.beta<.2));
  const before=await inside.locator('canvas').evaluate(c=>window.probe.camera.alpha);
  await inside.locator('canvas').dragTo(inside.locator('canvas'),{sourcePosition:{x:50,y:90},targetPosition:{x:180,y:90}});
  const after=await inside.locator('canvas').evaluate(c=>window.probe.camera.alpha);assert.notEqual(after,before);
  await page.evaluate(()=>window.send('alembic.web.play','p1',{scenario:'arena',context:{uses:[]}}));
  await page.waitForFunction(()=>window.received.some(x=>x?.type==='alembic.web.result'&&x.id==='p1'));
  assert.equal(await inside.locator('canvas').evaluate(()=>window.probe.plays),1);
  assert.deepEqual(await inside.locator('canvas').evaluate(()=>[probe.binding.state.io_lock,document.querySelector('#hud').hidden]),[false,true]);
  const interaction=async(id,extra,type='alembic.web.interaction')=>{
    await page.evaluate(([id,extra,type])=>window.send(type,id,extra),[id,extra,type]);
    await page.waitForFunction(id=>window.received.some(x=>x?.type==='alembic.web.interaction.result'&&x.id===id),id);
    const reply=await page.evaluate(id=>window.received.find(x=>x?.type==='alembic.web.interaction.result'&&x.id===id),id);assert.equal(reply.ok,true);return reply.state;
  };
  await interaction('configure',{interaction:{io_lock:true},threeD:true},'alembic.web.configure');
  await inside.locator('canvas').click();await page.keyboard.press('F3');
  await page.waitForFunction(()=>window.received.some(x=>x?.type==='alembic.web.interaction.key'&&x.key==='F3'&&x.session==='web-test'));
  await interaction('io-on',{io_lock:true});
  const oldZ=await inside.locator('canvas').evaluate(()=>probe.actor.position.z);
  await page.keyboard.down('w');await page.waitForTimeout(180);await page.keyboard.up('w');
  const moved=await inside.locator('canvas').evaluate(()=>({z:probe.actor.position.z,free:!probe.following&&probe.camera.getTarget().equalsWithEpsilon(BABYLON.Vector3.Zero()),hud:document.querySelector('#hud').hidden,interaction:probe.binding.state}));
  assert.ok(moved.z>oldZ&&moved.free&&!moved.hud,JSON.stringify({oldZ,...moved}));
  await interaction('io-off',{io_lock:false});
  await interaction('io-again',{io_lock:true});await inside.locator('canvas').focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>window.received.some(x=>x?.id===null&&x.state?.io_lock===false));
  await page.evaluate(()=>window.send('alembic.web.reset','r1'));
  await page.waitForFunction(()=>window.received.some(x=>x?.type==='alembic.web.result'&&x.id==='r1'));
  assert.equal(await inside.locator('canvas').evaluate(()=>window.probe.resets),1);
 } finally {await context?.close();if(helper){const done=once(helper,'exit');helper.stdin.end();await done;lines.close()}controller.closeAllConnections();await new Promise(resolve=>controller.close(resolve))}
});
