// Run in native Windows Node with a private backend/al URL file as argv[2].
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
if(!process.argv[2])throw new Error('Provide a private launch URL file');
const profile=await mkdtemp(join(process.env.TEMP,'alembic-ui-reload-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],viewport:{width:1400,height:900}});
try{
const page=context.pages()[0],errors=[];
// Prove light iframe display/IO/reload work with no optional runtime adapter at all.
await page.route('**/__al/app.js',route=>route.fulfill({contentType:'text/javascript',body:'// No authored render binding'}));
await page.addInitScript(()=>{window.handshakes=[];addEventListener('message',e=>{if(['alembic.web.connect','alembic.web.configure'].includes(e.data?.type))handshakes.push(e.data.type)})});
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+new URL(r.url()).pathname)});
const url=(await readFile(process.argv[2],'utf8')).trim();
for(let attempt=0;;attempt++){try{await page.goto(url,{waitUntil:'domcontentloaded'});break}catch{if(attempt>=30)throw Error('Relay did not become reachable from Windows');await page.waitForTimeout(100)}}
await page.waitForTimeout(2000);
const embedded=page.frames().find(f=>f.url().includes('/app/'));
if(!embedded)throw new Error('Self-embedded frontend was not loaded');
if(embedded){await embedded.evaluate(()=>window.__alembic.open('sample.iframe'));await page.waitForTimeout(2500);const leaf=page.frames().at(-1);await leaf.evaluate(()=>location.reload());await page.waitForTimeout(11000);}
for(const frame of page.frames()) {
 const state=await frame.evaluate(()=>({app:!!window.__alembic?.state().file,
  status:document.querySelector('.status')?.textContent||'',
  disabled:document.querySelector('[aria-label=io_lock]')?.disabled,handshakes:window.handshakes||[],
  hidden:[...document.querySelectorAll('.viewport iframe')].some(f=>getComputedStyle(f).visibility==='hidden')}));
 if(state.app && state.handshakes.length)throw new Error('Light iframe used the strict handshake');
 if(state.app && (state.hidden||state.disabled||state.status.includes('adapter did not become ready')||state.status.includes('did not bind')))
  throw new Error('Nested iframe failed to recover: '+JSON.stringify(state));
}
await page.getByRole('button',{name:'io_lock',exact:true}).click();
if(await page.locator('.viewport > iframe').getAttribute('inert')!==null)throw new Error('IO did not enable the host iframe');
await page.keyboard.press('Escape');
if(await page.locator('.viewport > iframe').getAttribute('inert')===null)throw new Error('Escape did not restore inspection');
console.log('PASS: nested light iframes display/reload without a runtime adapter or configure handshake; host IO and Escape work');
// An optional app binding emits unconfigured interaction state when it loses focus.
// It must not disable the host's button or prevent the next click from enabling IO.
await page.unroute('**/__al/app.js');
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('[aria-label=io_lock]')?.disabled===false);
const app=await (async()=>{for(let i=0;i<100;i++){const f=page.frames().find(f=>f.url().includes('/app/'));if(f&&await f.evaluate(()=>!!window.__alEmbedded).catch(()=>false))return f;await page.waitForTimeout(100)}throw Error('Optional app binding did not load')})();
await app.evaluate(()=>{
 const input=document.createElement('input');input.id='io-probe';
 Object.assign(input.style,{position:'fixed',top:'10px',left:'10px',zIndex:'2147483647'});
 document.body.append(input);
});
const io=page.getByRole('button',{name:'io_lock',exact:true});
const appearance=()=>io.evaluate(e=>({pressed:e.getAttribute('aria-pressed'),weight:getComputedStyle(e).fontWeight,color:getComputedStyle(e).color,disabled:e.disabled}));
const inactive=await appearance();assert.equal(inactive.weight,'400');assert.equal(inactive.pressed,'false');
await io.click();
assert.equal((await appearance()).weight,'700');
await app.locator('#io-probe').click();await page.keyboard.type('iframe input works');
assert.equal(await app.locator('#io-probe').inputValue(),'iframe input works');
assert.equal((await appearance()).pressed,'true','The first app click must not reset host IO');
const render=page.getByRole('button',{name:'Render',exact:true});
await render.click();await render.click();
await page.waitForTimeout(100);
assert.equal((await appearance()).disabled,false,'App blur must not disable host IO');
assert.equal((await appearance()).pressed,'true');
assert.notEqual((await appearance()).color,inactive.color);
await io.click();assert.equal((await appearance()).pressed,'false');
await io.click();assert.equal((await appearance()).pressed,'true');
await page.keyboard.press('Escape');
assert.equal((await appearance()).pressed,'false');
assert.equal((await appearance()).weight,'400');
assert.equal((await appearance()).disabled,false);
console.log('PASS: iframe IO stays enabled across app focus/blur, accepts keyboard input, toggles bold/muted and releases on Escape');
}finally{await context.close();await rm(profile,{recursive:true,force:true})}
