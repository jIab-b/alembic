import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const runtime=`<!doctype html><canvas tabindex="0"></canvas><script type="module">
import {bindInteraction} from '/interaction.js';
window.applied={io:true,screen:true,hud:true,held:3};window.trace=[];
const hooks={release:()=>{trace.push('release');applied.held=0},io_lock:async on=>{if(on&&window.failOnEnable)throw Error('Runtime rejected IO');trace.push(['io',on]);applied.io=on;applied.hud=on}};
hooks.screen_lock=()=>{throw Error('Retired hook called')};
window.binding=bindInteraction(hooks);await binding.ready;
parent.postMessage({type:'test.ready',interaction:binding.state},location.origin);
</script>`;
test('web runtime hooks enforce opt-in independently and release actual frame input on blur/Escape',{timeout:30000},async t=>{
  let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch(error){if(error.code==='MODULE_NOT_FOUND'){t.skip('Playwright unavailable');return;}throw error;}
  const source=await readFile(new URL('../frontend/public/assets/play/interaction.js',import.meta.url));
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/interaction.js'?'text/javascript':'text/html');
    res.end(req.url==='/interaction.js'?source:req.url.startsWith('/runtime')?runtime:`<!doctype html><button id="outside">Focus outside</button><iframe id="runtime" src="/runtime"></iframe><iframe id="spoof" src="about:blank"></iframe><script>
    window.messages=[];let serial=0;addEventListener('message',event=>messages.push(event.data));
    window.command=(type,extra)=>new Promise((resolve,reject)=>{const frame=document.querySelector('#runtime'),id='request-'+(++serial);const timer=setTimeout(()=>{removeEventListener('message',receive);reject(Error('No interaction acknowledgement'))},2000);function receive(event){if(event.source!==frame.contentWindow||event.origin!==location.origin||event.data.id!==id)return;clearTimeout(timer);removeEventListener('message',receive);resolve(event.data)}addEventListener('message',receive);frame.contentWindow.postMessage({type,id,...extra},location.origin)});
    </script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>messages.some(row=>row.type==='test.ready'));
    const frame=page.frameLocator('#runtime'),state=()=>frame.locator('canvas').evaluate(()=>binding.state);
    const command=(type,extra)=>page.evaluate(([type,extra])=>command(type,extra),[type,extra]);
    const change=extra=>command('alembic.web.interaction',extra),configure=(interaction,threeD=true)=>command('alembic.web.configure',{interaction,threeD});
    assert.deepEqual(await frame.locator('canvas').evaluate(()=>applied),{io:false,screen:true,hud:false,held:0});
    assert.equal((await state()).configured,false);assert.equal((await change({io_lock:true})).ok,false);
    await frame.locator('canvas').click();await page.keyboard.down('F3');await page.keyboard.down('F3');await page.keyboard.up('F3');await page.keyboard.press('F4');
    await page.waitForFunction(()=>messages.filter(row=>row.type==='alembic.web.interaction.key').length===1);
    assert.deepEqual(await page.evaluate(()=>messages.filter(row=>row.type==='alembic.web.interaction.key').map(row=>row.key)),['F3']);
    assert.equal((await state()).io_lock,false);assert.equal((await state()).screen_lock,undefined);
    assert.equal((await configure({io_lock:true})).ok,true);
    assert.equal((await change({io_lock:true})).state.io_lock,true);
    assert.equal((await change({screen_lock:true})).ok,false);assert.equal((await state()).io_lock,true);
    assert.equal((await change({io_lock:false})).ok,true);
    await page.frameLocator('#spoof').locator('body').evaluate(()=>parent.document.querySelector('#runtime').contentWindow.postMessage({type:'alembic.web.interaction',id:'spoof',io_lock:true},parent.location.origin));
    await page.waitForTimeout(30);assert.equal((await state()).io_lock,false);
    await change({io_lock:true});
    await frame.locator('canvas').click();await page.locator('#outside').click();
    await page.waitForFunction(()=>document.querySelector('#runtime').contentWindow.binding.state.io_lock===false);
    assert.equal((await state()).screen_lock,undefined);
    assert.equal((await configure({io_lock:true},false)).ok,true);
    assert.equal((await change({screen_lock:true})).ok,false);
    await change({io_lock:true});await frame.locator('canvas').click();await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('#runtime').contentWindow.binding.state.io_lock===false);
    await frame.locator('canvas').evaluate(()=>window.failOnEnable=true);
    const reply=await change({io_lock:true});assert.equal(reply.ok,false);assert.match(reply.error,/Runtime rejected IO/);assert.equal(reply.state.io_lock,false);
    for(const invalid of [{io_lock:'true'},{pointer_lock:true},{target:{code:'not executable'}}])assert.equal((await change(invalid)).ok,false);
    await frame.locator('canvas').evaluate(()=>binding.dispose());assert.equal((await state()).io_lock,false);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
