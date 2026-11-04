import assert from 'node:assert/strict';
import {renderFrame} from './render-frame.mjs';
import {drag} from './windows-checks.mjs';
export async function check(context) {
 if(process.env.ALEMBIC_CASE==='completion')return completionCheck(context);
 if(process.env.ALEMBIC_CASE==='waiter')return waiterCheck(context);
 const {page,step,result}=context;
 page.setDefaultTimeout(6000);
 const open=async path=>{const src=await page.locator('.viewport iframe').getAttribute('src').catch(()=>'');await page.evaluate(path=>__alembic.open(path),path);return renderFrame(page,src)};
 await step('audioIOAndOutput',async()=>{
  const frame=await open('audio/tone.audio');await frame.waitForFunction(()=>document.querySelector('audio'));
  await frame.evaluate(()=>{window.keys=0;addEventListener('keydown',()=>keys++);const a=document.querySelector('audio'),c=new AudioContext(),n=new AnalyserNode(c);c.createMediaElementSource(a).connect(n).connect(c.destination);window.meter=n;window.context=c});
  const io=page.getByRole('button',{name:'io_lock',exact:true});await page.waitForFunction(()=>!document.querySelector('[aria-label=io_lock]').disabled);await io.click();assert.equal(await io.getAttribute('aria-pressed'),'true');await page.keyboard.press('k');await frame.waitForFunction(()=>keys>0);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('[aria-label=io_lock]').getAttribute('aria-pressed')==='false');
  await page.locator('summary[aria-label=Playback]').click();await page.getByRole('menuitem',{name:/Listen/}).click();await page.getByRole('button',{name:'Play replay',exact:true}).click();await frame.evaluate(()=>context.resume());
  await frame.waitForFunction(()=>{const a=new Float32Array(256);meter.getFloatTimeDomainData(a);window.peak=Math.max(...a.map(Math.abs));return peak>.2});return frame.evaluate(()=>({keys,peak,duration:document.querySelector('audio').duration}));
 });
 await step('plainAudioSeek',async()=>{
  await page.evaluate(()=>__alembic.open('audio/tone.audio/tone.wav'));await page.waitForFunction(()=>document.querySelector('.viewport>audio')?.duration>1.9);
  const play=page.getByRole('button',{name:'Play replay',exact:true});await play.click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.05);
  await page.locator('[aria-label="Replay position"]').evaluate(e=>{e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForFunction(()=>Math.abs(document.querySelector('audio').currentTime-1)<.05);return {plays:true,seek:1};
 });
 for(const node of ['i2d/flat.i2d','i3d/box.i3d'])await step('area-'+node,async()=>{
  await open(node);await page.waitForTimeout(200);assert.equal(await page.locator('.area.active .edge.top').count(),0);
  await page.getByRole('button',{name:'area',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label=area]').getAttribute('aria-pressed')==='true');const b=await page.locator('.viewport').boundingBox();await drag(page,[b.x+80,b.y+80],[b.x+240,b.y+240],5);await page.locator('.areas .dot').first().waitFor();assert.equal(await page.locator('.area-label').count(),0);
  await page.mouse.click(b.x+160,b.y+160);await page.getByRole('menuitem',{name:'Prompt',exact:true}).waitFor();await page.getByRole('menuitem',{name:'Delete',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.area'));return {empty:0,selectedIcon:0,deleted:true};
 });
 await step('dragLatency',async()=>{
  await page.evaluate(()=>__alembic.select({shape:'sphere',center:[0,0,0],radius:.5}));await page.locator('.handles .dot').first().waitFor();
  for(const [name,selector] of [['handle','.handles .dot'],['area','.areas .dot']]){
   if(name==='area'){await page.getByRole('button',{name:'area',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label=area]').getAttribute('aria-pressed')==='true');const b=await page.locator('.viewport').boundingBox();await drag(page,[b.x+80,b.y+80],[b.x+240,b.y+240],5);await page.locator(selector).first().waitFor()}
   await page.evaluate(selector=>{window.delays=[];window.at=0;addEventListener('pointermove',()=>window.at=performance.now());new MutationObserver(()=>{if(window.at){delays.push(performance.now()-window.at);window.at=0}}).observe(document.querySelector(selector).parentElement,{attributes:true,subtree:true})},selector);
   const b=await page.locator(selector).first().boundingBox();await drag(page,[b.x+b.width/2,b.y+b.height/2],[b.x+b.width/2+32,b.y+b.height/2+8],16);result[name]=await page.evaluate(()=>({samples:delays.length,mean:delays.reduce((a,b)=>a+b,0)/delays.length,max:Math.max(...delays)}));assert.ok(result[name].samples>0);
  }return true;
 });
}
export async function waiterCheck({page,step,file}) {
 const config=new URLSearchParams(new URL(process.env.ALEMBIC_URL).hash.slice(1)),headers={Authorization:'Bearer '+config.get('token')};
 const run=async data=>{const r=await page.request.post(config.get('node')+'/vms/local/run',{headers,data});assert.equal(r.status(),200);return r.json()};
 await step('waiterRouting',async()=>{
  await page.waitForFunction(()=>/\$\s*$/.test(document.querySelector('.xterm-rows')?.textContent||''));const terminal=page.locator('.native-agent-terminal .xterm-helper-textarea');await terminal.focus();await page.keyboard.type('./codex\r');await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-ready'));
  await run({argv:['python3','-c','import subprocess;from pathlib import Path;p=subprocess.Popen(["'+process.env.ALEMBIC_CLI+'","--project",str(Path.cwd()),"wait","--name","event-agent"],stdout=open("waiter.txt","w"),stdin=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True);Path("waiter.pid").write_text(str(p.pid))']});
  const menu=async()=>{const p=page.locator('.help-content');if(!await p.evaluate(e=>e.matches(':popover-open')))await page.getByRole('button',{name:'Agent connection',exact:true}).click()};
  await menu();await page.getByRole('button',{name:'event-agent',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.connection-dot.on'));
  await page.evaluate(()=>__alembic.open('model.i3d'));await page.waitForFunction(()=>__alembic.pose());
  const send=async text=>{await page.evaluate(text=>__alembic.select({shape:'sphere',center:[text==='waiter only' ? .35 : .1,-.25,0],radius:.4,tag:text}),text);const b=await page.locator('.viewport').boundingBox(),p=await page.evaluate(()=>__alembic.project(__alembic.selection().selections.at(-1).center));await page.mouse.click(b.x+p[0],b.y+p[1],{button:'right'});await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();await page.locator('.node textarea').fill(text);await page.locator('.node').getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.node .brew:not(.still)'));await page.waitForTimeout(50)};
  await send('waiter only');assert.match((await file('waiter.txt')).toString(),/waiter only/);
  await menu();await page.getByRole('button',{name:'codex (embedded)',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await send('pty only');await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-received'));assert.match((await file('prompt.txt')).toString(),/pty only/);assert.doesNotMatch((await file('waiter.txt')).toString(),/pty only/);
  await menu();const row=page.locator('.session-row').filter({has:page.getByRole('button',{name:'event-agent',exact:true})});await row.getByRole('button',{name:'Disconnect',exact:true}).click();assert.ok(await row.getByRole('button',{name:'Reconnect',exact:true}).count());
  await run({argv:['python3','-c','import os,signal;from pathlib import Path;os.kill(int(Path("waiter.pid").read_text()),signal.SIGTERM)']});await page.getByRole('button',{name:'event-agent',exact:true}).waitFor({state:'detached'});return {green:true,selectedRouting:true,disconnect:true,killedRemoved:true};
 });
}

async function completionCheck({page, step, file, result}) {
 page.setDefaultTimeout(6000);
 const config = new URLSearchParams(new URL(process.env.ALEMBIC_URL).hash.slice(1));
 const headers = {Authorization: 'Bearer ' + config.get('token')}, cli = process.env.ALEMBIC_CLI;
 const request = page.context().request;
 const run = async argv => {
  const r = await request.post(config.get('node') + '/vms/local/run', {headers, data: {argv}});
  assert.equal(r.status(), 200); return r.json();
 };
 const python = code => run(['python3', '-c', code]);
 const menu = async action => {
  await page.locator('.area.active .edge.top').click({button: 'right', position: {x: 12, y: 2}});
  await page.getByRole('menuitem', {name: action, exact: true}).click();
 };
 const card = id => page.locator(`.node[data-highlight="${id}"]`);
 let placement = 0;
 const area = async text => {
  if ((await page.evaluate(() => __alembic.state().file)).startsWith('i2d/'))
   await (await renderFrame(page)).waitForFunction(() => window.effects);
  const before = await page.evaluate(() => __alembic.selection().selections.length);
  await page.getByRole('button', {name: 'area', exact: true}).click();
  const b = await page.locator('.viewport').boundingBox();
  const y = ++placement % 2 ? 70 : 300;
  await drag(page, [b.x + 60, b.y + y], [b.x + 200, b.y + y + 140], 4);
  await page.waitForFunction(n => __alembic.selection().selections.length > n, before);
  await page.locator('.area.active .edge.top').waitFor();
  const id = await page.evaluate(() => __alembic.selection().selections.at(-1).id);
  await menu('Prompt'); await card(id).locator('textarea').fill(text); return id;
 };
 const send = id => card(id).getByRole('button', {name: 'Send', exact: true}).click();
 const received = async text => {
  for (let i = 0; i < 70; i++) {
   const r = await python('from pathlib import Path;print(Path("waiter.txt").read_text())');
   const line = r.stdout_tail.split('\n').find(line => line.includes(text));
   if (line) return line.match(/details: ([^)]+)\)/)[1];
   await page.waitForTimeout(60);
  }
  assert.fail('Receiver did not receive ' + text);
 };
 const done = async details => {
  const r = await run([cli, 'done', details]); assert.equal(r.exit, 0, r.stderr_tail);
 };
 const reload = async () => {
  await page.reload(); await page.waitForFunction(() => window.__alembic);
  await page.evaluate(() => __alembic.ready());
  await page.waitForTimeout(150);
 };
 if (process.env.ALEMBIC_RESTART_PHASE === 'resume') {
  await step('completion-browser-and-backend-restart', async () => {
   await page.waitForFunction(() => window.__alembic); await page.evaluate(() => __alembic.ready());
   const {id, details} = JSON.parse((await file('restart.json')).toString());
   await card(id).locator('.brew:not(.still)').waitFor();
   assert.equal(await page.locator('.area.active').count(), 1);
   await done(details); await card(id).waitFor({state: 'detached'});
   await python('import os,signal;from pathlib import Path;' +
    'os.kill(int(Path("waiter.pid").read_text()),signal.SIGTERM)');
   return {brewRestored: true, cleared: true};
  });
  return;
 }
 await page.waitForFunction(() => /\$\s*$/.test(document.querySelector('.xterm-rows')?.textContent || ''));
 await page.evaluate(() => __alembic.open('i3d/model.i3d')); await page.waitForFunction(() => __alembic.pose());
 await step('completion-no-connection', async () => {
  const id = await area('no connection'); await send(id);
  await card(id).getByText('No active session in terminal', {exact: true}).waitFor();
  await menu('Delete'); return {visibleFailure: true};
 });
 await python('import subprocess;from pathlib import Path;' +
  'p=subprocess.Popen([' + JSON.stringify(cli) + ',"wait","--name","completion-receiver"],' +
  'stdout=open("waiter.txt","w"),stderr=subprocess.DEVNULL,start_new_session=True);' +
  'Path("waiter.pid").write_text(str(p.pid))');
 await page.waitForFunction(() => document.querySelector('.connection-dot.on'));
 result.gpu = await page.evaluate(async () => {
  const adapter = await navigator.gpu.requestAdapter();
  return {vendor: adapter?.info.vendor, fallback: adapter?.isFallbackAdapter || false};
 });
 assert.ok(result.gpu.vendor); assert.equal(result.gpu.fallback, false);
 assert.doesNotMatch(result.gpu.vendor, /software|swiftshader|microsoft/i);
 if (process.env.ALEMBIC_RESTART_PHASE === 'seed') {
  await step('completion-before-restart', async () => {
   const id = await area('survive a full restart'); await send(id);
   const details = await received('survive a full restart');
   await card(id).locator('.brew:not(.still)').waitFor();
   await python('from pathlib import Path;Path("restart.json").write_text(' +
    JSON.stringify(JSON.stringify({id, details})) + ')');
   return {brewing: true};
  });
  return;
 }
 for (const node of [process.env.ALEMBIC_COMPLETION_NODE || 'i3d/model.i3d']) {
  await page.evaluate(node => __alembic.open(node), node);
  if (node.startsWith('i2d')) await renderFrame(page);
  for (const mode of ['delivered', 'prompt', 'highlight', 'both', 'reload', 'closed', 'two', 'resend']) {
   await step('completion-' + node + '-' + mode, async () => {
    const text = node + '-' + mode, id = await area(text);
    let release, blocked;
    const waiting = new Promise(resolve => blocked = resolve);
    const intercept = async route => {
     const r = route.request(), path = new URL(r.url()).searchParams.get('path');
     if (r.method() === 'PUT' && path?.startsWith('.alembic/selections/') && path.endsWith('.json')) {
      blocked(); await new Promise(resolve => release = resolve);
     }
     await route.continue();
    };
    if (['prompt', 'highlight', 'both'].includes(mode)) await page.route('**/w/project/file?**', intercept);
    await send(id);
    if (['prompt', 'highlight', 'both'].includes(mode)) {
     await waiting;
     if (mode !== 'highlight') await card(id).getByRole('button', {name: 'Close', exact: true}).click();
     if (mode !== 'prompt') await menu('Delete');
     assert.equal(await card(id).count(), 0); release();
    }
    const details = await received(text), context = JSON.parse((await file(details)).toString());
    assert.ok((await file(context.selection.crop)).length, 'Crop survives UI deletion');
    if (release) await page.unroute('**/w/project/file?**', intercept);
    if (mode === 'reload') { await reload(); await card(id).locator('.brew:not(.still)').waitFor(); }
    if (mode === 'closed') {
     const context = page.context(); await page.close(); await done(details); page = await context.newPage();
     page.setDefaultTimeout(6000); page.on('pageerror', e => result.errors.push(e.message));
     await page.goto(process.env.ALEMBIC_URL);
    }
    if (mode === 'two') {
     const second = await area(text + '-second'); await send(second); const d2 = await received(text + '-second');
     await done(details); await card(id).waitFor({state: 'detached'});
     await card(second).locator('.brew:not(.still)').waitFor(); await done(d2);
     await card(second).waitFor({state: 'detached'});
    } else if (mode === 'resend') {
     await card(id).getByRole('button', {name: 'Close', exact: true}).click();
     await menu('Prompt'); await card(id).locator('textarea').fill(text + '-new'); await send(id);
     const newer = await received(text + '-new'); assert.notEqual(newer, details);
     await done(details); await page.waitForTimeout(1200); await card(id).locator('.brew:not(.still)').waitFor();
     await done(newer); await card(id).waitFor({state: 'detached'});
    } else {
     if (mode === 'delivered') {
      await page.waitForTimeout(1250); await card(id).locator('.brew:not(.still)').waitFor();
      assert.equal(await card(id).getByRole('status').innerText(), 'Brewing');
      assert.equal(await page.locator('.area.active').count(), 1);
     }
     const at = Date.now(); if (mode !== 'closed') await done(details);
     if (mode === 'closed') {
      await page.waitForFunction(() => window.__alembic); await page.evaluate(() => __alembic.ready());
     }
     await card(id).waitFor({state: 'detached'});
     await page.waitForFunction(() => !document.querySelector('.area.active'));
     if (mode === 'delivered') { result.completionMs = Date.now() - at; assert.ok(result.completionMs < 1600); }
    }
    await done(details); // A second invocation remains harmless after receipt cleanup.
    if (['prompt', 'highlight', 'both', 'closed'].includes(mode)) {
     await reload(); assert.equal(await card(id).count(), 0);
    }
    return {delivered: true, cropRetained: true, completed: true};
   });
  }
 }
 await step('completion-cleanup-and-invalid-path', async () => {
  for (let i = 0; i < 30; i++) {
   const r = await python('from pathlib import Path;print(len(list(Path(".alembic/selections").rglob("*.done"))))');
   if (r.stdout_tail.trim() === '0') break; await page.waitForTimeout(100);
  }
  assert.equal((await python('from pathlib import Path;print(len(list(Path(".alembic/selections")' +
   '.rglob("*.done"))))')).stdout_tail.trim(), '0');
  const r = await run([cli, 'done', 'bad.json']); assert.notEqual(r.exit, 0); assert.match(r.stderr_tail, /Expected/);
  return {markers: 0, malformed: 'non-zero'};
 });
 await python('import os,signal;from pathlib import Path;os.kill(int(Path("waiter.pid").read_text()),signal.SIGTERM)');
}
