// Real effect: Windows Chrome, isolated PTYs, tests/fixtures/codex; no model calls.
import assert from 'node:assert/strict';
export async function check({page,step,file}) {
 const dot=page.getByRole('button',{name:'Agent connection',exact:true}),terminal=page.locator('.native-agent-terminal .xterm-helper-textarea');
 const config=new URLSearchParams(new URL(process.env.ALEMBIC_URL).hash.slice(1));
 const run=async data=>{const r=await page.request.post(config.get('node')+'/vms/local/run',{headers:{Authorization:'Bearer '+config.get('token')},data});assert.equal(r.status(),200);return r.json()};
 const rows=async()=>JSON.parse((await run({actor:'terminal-connections'})).stdout_tail).rows;
 const input=async text=>{await terminal.focus();await page.keyboard.type(text+'\r',{delay:5})};
 const received=async(path,text)=>{for(let i=0;i<80;i++){const r=await run({argv:['python3','-c','from pathlib import Path;import sys;p=Path(sys.argv[1]);print(p.exists() and sys.argv[2] in p.read_text())',path,text]});if(r.stdout_tail.trim()==='True')return;await page.waitForTimeout(100)}assert.fail('Missing PTY receipt '+text)};
 const colour=async on=>{await page.waitForFunction(on=>document.querySelector('.connection-dot')?.classList.contains('on')===on,on)};
 const menu=async()=>{if(!await page.locator('.help-content').evaluate(e=>e.matches(':popover-open')))await dot.click()};
 const row=name=>page.locator('.session-row').filter({has:page.getByText(name,{exact:true})});
 await step('unboxedDot',async()=>{
  await page.waitForFunction(()=>/\$\s*$/.test(document.querySelector('.xterm-rows')?.textContent||''));
  await dot.hover();
  const style=await dot.evaluate(e=>{
   const s=getComputedStyle(e);
   return [e.offsetWidth,e.offsetHeight,s.borderWidth,s.backgroundColor];
  });
  assert.deepEqual(style,[28,28,'0px','rgba(0, 0, 0, 0)']);
  await dot.click();assert.equal(await dot.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
  assert.equal(await dot.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  assert.ok((await page.locator('.help-content').boundingBox()).width<240);
  return {clickArea:28,keyboardFocus:true,hoverBox:false};
 });
 let embedded,external;
 await step('shellIdleRestart',async()=>{await page.waitForFunction(()=>/\$\s*$/.test(document.querySelector('.xterm-rows')?.textContent||''));await colour(false);await menu();await page.getByText('No agents connected',{exact:true}).waitFor();await input('./codex');await colour(true);await menu();await row('codex (embedded)').waitFor();assert.equal(await row('codex (embedded)').getByRole('button').count(),1);embedded=(await rows()).find(r=>r.active);await page.waitForTimeout(2500);await colour(true);return {bareGrey:true,idleGreen:true}});
 await step('visiblePolling',async()=>{let count=0;const observe=r=>{if(r.url().endsWith('/run')&&r.postDataJSON()?.actor==='terminal-connections')count++};page.on('request',observe);await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));await page.waitForTimeout(2200);assert.equal(count,0);await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:false}));await page.waitForTimeout(2200);assert.ok(count>=1&&count<=3);page.off('request',observe);return {hidden:0,visible:count}});
 await step('externalRouting',async()=>{
  for(let i=0;i<60;i++){external=(await rows()).find(r=>r.external&&r.active);if(external)break;await page.waitForTimeout(500)}assert.ok(external,'Start attach --new fake agent concurrently');
  await menu();await row('✓ codex (embedded)').waitFor();await row('codex').getByRole('button',{name:'codex',exact:true}).click();
  await page.getByRole('button',{name:'model.i3d',exact:true}).click();await page.waitForFunction(()=>window.__alembic?.pose());await page.evaluate(()=>__alembic.select({shape:'sphere',center:[.35,-.25,0],radius:.4}));
  const b=await page.locator('.viewport').boundingBox(),p=await page.evaluate(()=>__alembic.project([.35,-.25,0]));await page.mouse.click(b.x+p[0],b.y+p[1],{button:'right'});await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();
  const send=async text=>{if(!await page.locator('.node textarea').count()){await page.mouse.click(b.x+p[0],b.y+p[1],{button:'right'});await page.getByRole('menuitem',{name:'Prompt',exact:true}).click()}await page.locator('.node textarea').fill(text);await page.locator('.node').getByRole('button',{name:'Send',exact:true}).click()};
  await send('exact external highlight');await received('external/prompt.txt','exact external highlight');assert.match((await file('external/prompt.txt')).toString(),/^# .*exact external highlight/);assert.equal((await rows()).find(r=>r.id===embedded.id).last_command,embedded.last_command);
  await menu();await row('codex (embedded)').getByRole('button',{name:'codex (embedded)',exact:true}).click();await send('exact embedded highlight');await received('prompt.txt','exact embedded highlight');assert.match((await file('prompt.txt')).toString(),/^# .*exact embedded highlight/);assert.doesNotMatch((await file('external/prompt.txt')).toString(),/exact embedded/);
  await menu();for(const r of [row('✓ codex (embedded)'),row('✓ codex')]){if(await r.count())await r.getByRole('button',{name:'Disconnect',exact:true}).click()}while(await page.getByRole('button',{name:'Disconnect',exact:true}).count())await page.getByRole('button',{name:'Disconnect',exact:true}).first().click();await colour(false);assert.equal((await rows()).filter(r=>r.active).length,2);
  await send('refused');await page.getByText('No active session in terminal',{exact:true}).waitFor();await menu();await page.getByRole('button',{name:'Reconnect',exact:true}).first().click();await colour(true);assert.equal(await page.locator('.session-row').getByRole('button').count(),2);assert.doesNotMatch((await file('prompt.txt')).toString(),/refused/);await page.getByRole('button',{name:'Retry',exact:true}).click();await received('prompt.txt','refused');assert.match((await file('prompt.txt')).toString(),/refused/);return {selectedPtyOnly:true,disconnectAlive:2,refused:true,reconnected:true};
 });
 await step('exitAndRestart',async()=>{await run({argv:['python3','-c','import os,signal,sys;[os.kill(int(p),signal.SIGTERM) for p in sys.argv[1:]]',String(embedded.program.pid),String(external.program.pid)]});await colour(false);await menu();assert.equal(await page.locator('.session-row').count(),0);await input('./codex');await colour(true);return {removed:true,restarted:true}});
}
