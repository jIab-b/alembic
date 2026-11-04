// Headless Windows Chrome against a disposable real Vault. Output/profile are caller-owned temp paths.
import {createRequire} from 'node:module';
import {writeFile, rm} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {renderFrame} from '../tests/render-frame.mjs';
import {drag} from '../tests/windows-checks.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {ALEMBIC_URL:url,ALEMBIC_OUT:out,ALEMBIC_PROFILE:profile}=process.env;
if(!url||!out||!profile||!/^alembic-ui-[\w-]+$/.test(relative(process.env.TEMP,resolve(profile)))||/^(\\\\|\/\/)/.test(profile))throw Error('Use an alembic-ui-* profile directly under Windows TEMP');
const config=new URLSearchParams(new URL(url).hash.slice(1)), origin=config.get('node'), token=config.get('token'), workspace=config.get('workspace');
let context;const result={checks:{},errors:[],expected404:[]}, counts={};
try {
 context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],viewport:{width:1400,height:860},args:['--no-first-run','--no-default-browser-check','--disable-extensions','--mute-audio']});
 const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',e=>result.errors.push(e.stack||e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))result.errors.push(m.text())});
 page.on('response',r=>{if(r.status()<400)return;const u=new URL(r.url()),p=u.searchParams.get('path');if(r.status()===404&&p?.startsWith('.alembic/'))result.expected404.push(p);else {result.errors.push('HTTP '+r.status()+' '+u.pathname);if(r.status()>=500)r.text().then(body=>result.errors.push(body.slice(0,800)))}});
 const file=async path=>{const response=await page.request.get(origin+'/w/'+workspace+'/file?'+new URLSearchParams({path,at:'live'}),{headers:{Authorization:'Bearer '+token}});assert.equal(response.status(),200);return response.body()};
 const shot=async name=>page.screenshot({path:resolve(out,name+'.png')});
 const step=async(name,fn)=>{try{result.checks[name]=await fn()??true}catch(e){result.checks[name]={failed:e.message.slice(0,1200),terminal:await page.locator('.xterm-rows').innerText().catch(()=>''),status:await page.locator('.node,.status').allInnerTexts()};await shot('failed-'+name);process.exitCode=1}};
 await page.goto(url,{waitUntil:'domcontentloaded'});
 if(process.env.ALEMBIC_CHECK)await (await import(pathToFileURL(process.env.ALEMBIC_CHECK).href)).check({page,result,step,shot,file});else {
 await step('tree',async()=>{await page.getByRole('button',{name:'model.i3d',exact:true}).waitFor();await page.getByRole('button',{name:'picture.i2d',exact:true}).waitFor();return 2});
 await step('glb',async()=>{
  await page.getByRole('button',{name:'model.i3d',exact:true}).click();await page.waitForFunction(()=>window.__alembic?.state().kind==='model'&&window.__alembic.pose());
  await page.waitForFunction(()=>document.querySelector('.scene canvas')?.style.visibility!=='hidden');
  const state=await page.evaluate(()=>window.__alembic.state());assert.match(state.backend,/WebGPU/);
  result.gpu=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});return {vendor:a?.info.vendor,description:a?.info.description,architecture:a?.info.architecture,fallback:a?.isFallbackAdapter||a?.info.isFallbackAdapter||false}});
  assert.ok(result.gpu.vendor);assert.ok(!result.gpu.fallback);assert.doesNotMatch(JSON.stringify(result.gpu),/swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i);
  const png=await page.locator('.scene canvas').screenshot();await writeFile(resolve(out,'glb-canvas.png'),png);
  const colors=await page.evaluate(async b=>{const i=new Image();i.src='data:image/png;base64,'+b;await i.decode();const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.drawImage(i,0,0,64,64);const p=x.getImageData(0,0,64,64).data,s=new Set();for(let k=0;k<p.length;k+=4)s.add(p.slice(k,k+3).join(','));return s.size},png.toString('base64'));assert.ok(colors>4,'Nonblank model pixels');return {backend:state.backend,colors};
 });
 await step('toolbar',async()=>{
  const tools=await page.locator('[aria-label="Selection tools"] button').evaluateAll(a=>a.map(e=>e.getAttribute('aria-label')));assert.deepEqual(tools,['area','sphere','box','pick']);
  for(const label of ['io_lock','Render','Playback'])assert.equal(await page.locator(`${label==='Playback'?'summary':''}[aria-label="${label}"]`).count(),1,label);
  result.toolbarLayout=await page.locator('.selection-pane button,.selection-pane summary').evaluateAll(a=>a.map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height}}));await shot('toolbar');return tools;
 });
 await step('highlightOrbit',async()=>{
  await page.getByRole('button',{name:'sphere',exact:true}).click();const box=await page.locator('.viewport').boundingBox();
  const point=await page.evaluate(()=>window.__alembic.project([.35,-.25,0]));await page.mouse.click(box.x+point[0],box.y+point[1]);
  await page.waitForFunction(()=>window.__alembic.selection().selections.some(s=>s.shape==='sphere'));
  const before=await page.evaluate(()=>{const s=window.__alembic.selection().selections.at(-1);return {selection:s,point:window.__alembic.project(s.center),pose:window.__alembic.pose()}});
  assert.ok(before.selection.objects.length,'Highlight captures actual mesh identity');
  await drag(page,[box.x+box.width*.8,box.y+box.height*.65],[box.x+box.width*.8-110,box.y+box.height*.65+35],12);
  const after=await page.evaluate(()=>{const s=window.__alembic.selection().selections.at(-1);return {selection:s,point:window.__alembic.project(s.center),pose:window.__alembic.pose(),dots:[...document.querySelectorAll('.handles .dot')].map(e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top)}))}});
  assert.deepEqual(after.selection.center,before.selection.center);assert.deepEqual(after.selection.objects,before.selection.objects);assert.notDeepEqual(after.pose,before.pose);
  assert.ok(Math.hypot(...after.point.map((n,i)=>n-before.point[i]))>2,'Projected highlight follows orbit');assert.equal(after.dots.length,8);
  assert.ok(Math.hypot(after.dots.reduce((n,p)=>n+p.x,0)/8-after.point[0],after.dots.reduce((n,p)=>n+p.y,0)/8-after.point[1])<12,'Visible handles track world highlight');
  await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>window.__alembic.pose()),after.pose,'No momentum after pointerup');await shot('orbit');return {objects:after.selection.objects.length,handles:after.dots.length,worldCenter:after.selection.center};
 });
 await step('promptCanvas',async()=>{
  const terminal=page.locator('.native-agent-terminal .xterm-helper-textarea');await terminal.focus();await page.keyboard.type('./codex\r',{delay:10});await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-ready'));
  const box=await page.locator('.viewport').boundingBox(),point=await page.evaluate(()=>window.__alembic.project(window.__alembic.selection().selections.at(-1).center));
  await page.mouse.click(box.x+point[0],box.y+point[1],{button:'right'});await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();await page.locator('.node textarea').fill('Keep this highlight attached');
  const card=await page.locator('.node header').boundingBox();await drag(page,[card.x+80,card.y+15],[card.x+110,card.y+35],4);
  await page.locator('.node').getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-received'));
  const line=(await file('prompt.txt')).toString();assert.match(line,/Node model\.i3d; view GLB \(model\.i3d\/model\.glb\)/);assert.match(line,/Keep this highlight attached/);
  const context=JSON.parse(await file(line.match(/details: ([^)]+)\)/)[1]));assert.equal(context.version,1);assert.equal(context.canvas.path,'model.i3d');assert.equal(context.canvas.view,'main');assert.equal(context.file,'model.i3d/model.glb');assert.ok(context.selection.objects.length);
  assert.equal((await file(context.selection.crop)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(await page.getByRole('tab').count(),1);assert.equal((await page.evaluate(()=>window.__alembic.state())).file,'model.i3d/model.glb');await shot('prompt');return {terminalReceived:true,capturedSource:context.file,view:context.canvas.view,version:context.version};
 });
 await step('area2d',async()=>{
  await page.getByRole('button',{name:'picture.i2d',exact:true}).click();await (await renderFrame(page)).locator('svg').waitFor();await page.getByRole('button',{name:'area',exact:true}).click();const b=await page.locator('.viewport').boundingBox();
  await drag(page,[b.x+b.width*.2,b.y+b.height*.2],[b.x+b.width*.6,b.y+b.height*.6],8);await page.locator('.areas .dot').first().waitFor();
  const area=await page.evaluate(()=>window.__alembic.selection().selections.at(-1));assert.equal(area.shape,'area');assert.ok(area.area.every(n=>n>=0&&n<=1));assert.equal(await page.locator('.areas .dot').count(),8);
  const handle=await page.locator('.areas .dot').first().boundingBox();await drag(page,[handle.x+handle.width/2,handle.y+handle.height/2],[handle.x+handle.width/2+35,handle.y+handle.height/2],5);await page.waitForFunction(w=>window.__alembic.selection().selections.at(-1).area[2]>w+.01,area.area[2]);
  await page.locator('.area.active .edge.top').click({button:'right'});await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();await page.locator('.node textarea').fill('Keep the blue rectangle');await page.locator('.node').getByRole('button',{name:'Send',exact:true}).click();
  let line='';for(let i=0;i<100;i++){line=(await file('prompt.txt')).toString();if(line.includes('Keep the blue rectangle'))break;await page.waitForTimeout(50)}
  assert.match(line,/Keep the blue rectangle/,'SVG prompt reached the real terminal');
  const doc=JSON.parse(await file(line.match(/details: ([^)]+)\)/)[1]));assert.equal(doc.file,'picture.i2d/picture.svg');assert.equal(doc.selection.shape,'area');assert.deepEqual(doc.selection.objects,[],'SVG capture retains main’s pixel-only area behavior');assert.ok(doc.selection.area[2]>area.area[2]+.01);assert.equal((await file(doc.selection.crop)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');await shot('area');return {objects:doc.selection.objects.length,handles:8,crop:true};
 });
 }
} catch(e){result.errors.push(e.message.split('\n')[0]);process.exitCode=1}
finally{await context?.close();await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});result.errors=[...new Set(result.errors)].map(s=>s.replace(/token=[^&\s]+/g,'token=redacted'));if(result.errors.length)process.exitCode=1;await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
