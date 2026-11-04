// Native Windows Chrome: real xterm paste and ordinary iframe adapter lifecycle.
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const profile=await mkdtemp(join(process.env.TEMP,'alembic-ui-adapter-'));
let context;
try {
 context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],viewport:{width:1000,height:700}});
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://localhost:18991'});
 const page=context.pages()[0];
 await page.route('http://localhost:18991/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><div id="terminal"></div><iframe id="runtime" src="/runtime"></iframe>
   <script>window.messages=[];addEventListener('message',e=>{if(e.source===document.querySelector('#runtime').contentWindow)messages.push(e.data)})</script>
   <script src="/xterm.js"></script><script type="module">import {browserPasteKey} from '/paste.js';window.bytes=[];window.term=new Terminal();term.attachCustomKeyEventHandler(browserPasteKey);term.open(document.querySelector('#terminal'));term.onData(s=>bytes.push(s));window.loaded=true;</script>`});
  if(path==='/runtime')return route.fulfill({contentType:'text/html',body:`<!doctype html><button id="content">Ordinary HTML app</button><script>window.__alApp={renders:['app'],scenarios:[]};</script><script type="module" src="/__al/app.js"></script>`});
  const files={'/xterm.js':'../frontend/node_modules/@xterm/xterm/lib/xterm.js','/paste.js':'../frontend/src/contract/terminal-paste.js','/__al/app.js':'../render/app.js','/assets/play/interaction.js':'../frontend/public/assets/play/interaction.js'};
  if(!files[path])return route.fulfill({status:404,body:'missing'});
  return route.fulfill({contentType:'text/javascript',body:await readFile(new URL(files[path],import.meta.url))});
 });
 await page.goto('http://localhost:18991/');
 await page.waitForFunction(()=>window.loaded&&messages.some(m=>m.type==='alembic.web.ready'));
 await page.evaluate(async()=>{await navigator.clipboard.writeText('plain text\nsecond line');term.write('\x1b[?2004h');});
 await page.waitForFunction(()=>term.modes.bracketedPasteMode);
 await page.locator('.xterm-helper-textarea').focus();
 await page.keyboard.press('Control+v');
 await page.waitForFunction(()=>bytes.length>0);
 assert.equal(await page.evaluate(()=>bytes.join('')),'\x1b[200~plain text\rsecond line\x1b[201~');
 await page.evaluate(()=>bytes=[]);await page.keyboard.press('Control+c');
 assert.equal(await page.evaluate(()=>bytes.join('')),'\x03','Ctrl+C still interrupts the process');
 const command=async(type,body={})=>page.evaluate(({type,body})=>new Promise(resolve=>{
  const frame=document.querySelector('#runtime'),id=String(Math.random());
  const receive=e=>{if(e.source===frame.contentWindow&&e.data?.id===id){removeEventListener('message',receive);resolve(e.data)}};
  addEventListener('message',receive);frame.contentWindow.postMessage({type,id,...body},location.origin);
 }),{type,body});
 const configure=()=>command('alembic.web.configure',{interaction:{io_lock:true},threeD:false});
 assert.equal((await configure()).state.configured,true);
 assert.equal((await command('alembic.web.interaction',{io_lock:true})).state.io_lock,true);
 const before=await page.evaluate(()=>messages.filter(m=>m.type==='alembic.web.ready').length);
 await page.evaluate(()=>document.querySelector('#runtime').contentWindow.postMessage({type:'alembic.web.connect'},location.origin));
 await page.waitForFunction(n=>messages.filter(m=>m.type==='alembic.web.ready').length>n,before);
 const reloaded=await page.evaluate(()=>messages.filter(m=>m.type==='alembic.web.ready').length);
 await page.frameLocator('#runtime').locator('#content').evaluate(()=>location.reload());
 await page.waitForFunction(n=>messages.filter(m=>m.type==='alembic.web.ready').length>n,reloaded);
 assert.equal((await configure()).state.io_lock,false,'Reload starts in inspection');
 assert.equal((await command('alembic.web.interaction',{screen_lock:true})).ok,false,'2D app cannot acquire screen lock');
 await page.frameLocator('#runtime').locator('#content').waitFor();
 console.log('PASS: Ctrl+V pastes text once, Ctrl+C works, iframe readiness replays, reload recovers, 2D permissions stay strict');
} finally {await context?.close();await rm(profile,{recursive:true,force:true})}
