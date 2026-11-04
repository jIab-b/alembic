// All Windows acceptance uses the one headless driver in tools/ui-check-windows.mjs.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {check as connectionsCheck} from './connections-browser.mjs';
import {renderFrame} from './render-frame.mjs';
import {check as skillsCheck} from './skills-browser.mjs';
export const checks = {
  skills: skillsCheck, connections: connectionsCheck, types: typesCheck, spatial: spatialCheck, engines: enginesCheck, playback: playbackCheck, formats: playbackCheck, embed: embedCheck, state: stateCheck, prompt: promptCheck, security: securityCheck, pointer: pointerCheck
};
export const check = async context => {
  const run = checks[process.env.ALEMBIC_CASE];
  assert.ok(run, 'Unknown Windows check: '+process.env.ALEMBIC_CASE);
  const deadline=setTimeout(()=>void context.page.context().close(),process.env.ALEMBIC_CASE==='skills'?180000:100000);
  try {return await run(context)} finally {clearTimeout(deadline)}
};
async function spatialCheck({page,result,step,shot}) {
 page.setDefaultTimeout(5000);
 const open=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(()=>window.__alembic?.pose());};
 let frame,box;
 await step('open',async()=>{await open('box.i3d');frame=page.frames().find(f=>f.url().includes('/app/'));await frame.waitForFunction(()=>window.fixture);box=await page.locator('.viewport').boundingBox();return frame.evaluate(()=>({camera:fixture.binding.state(),renderer:fixture.scene.getEngine().getGlInfo()}))});
 if(!frame)return;
 await step('toolbar',async()=>{const labels=await page.locator('[aria-label="Selection tools"] button').evaluateAll(a=>a.map(e=>e.getAttribute('aria-label')));assert.deepEqual(labels,['area','sphere','box','pick']);return {tools:labels,shapeMode:await page.getByRole('button',{name:'Shape mode'}).count()}});
 await step('sphere',async()=>{await page.getByRole('button',{name:'sphere',exact:true}).click();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.waitForFunction(()=>window.__alembic.selection().selections.some(s=>s.shape==='sphere'));const s=await page.evaluate(()=>window.__alembic.selection().selections.at(-1));assert.ok(s.objects.length);assert.ok(s.crop);await page.locator('.handles .dot').first().waitFor();return s});
 await step('orbit',async()=>{const p=await page.evaluate(()=>window.__alembic.pose());await drag(page,[box.x+box.width*.8,box.y+box.height*.7],[box.x+box.width*.8-90,box.y+box.height*.7+30],8);await page.waitForTimeout(40);const after=await page.evaluate(()=>window.__alembic.pose());assert.notDeepEqual(p,after);await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>window.__alembic.pose()),after);return {momentum:0}});
 await step('ioButton',async()=>{await page.getByRole('button',{name:'io_lock',exact:true}).click();await page.keyboard.press('k');await page.mouse.move(box.x+100,box.y+100);await frame.waitForFunction(()=>effects.keys>0);const state=await frame.evaluate(()=>({...effects,frames:undefined,lock:!!document.pointerLockElement,x:fixture.box.position.x}));assert.ok(state.io&&state.keys&&state.mouse);assert.equal(await page.locator('.handles .dot').count(),0);return state});
 await step('hotkeysEscape',async()=>{await page.keyboard.press('Escape');await frame.waitForFunction(()=>!effects.io);await page.keyboard.press('F3');await frame.waitForFunction(()=>effects.io);await page.keyboard.press('k');await page.keyboard.press('Escape');await frame.waitForFunction(()=>!effects.io);return frame.evaluate(()=>({keys:effects.keys,io:effects.io,lock:!!document.pointerLockElement}))});
 await step('controllerBlock',async()=>{await frame.evaluate(()=>effects.frames=[]);await page.waitForTimeout(30);await page.evaluate(()=>{const end=performance.now()+200;while(performance.now()<end){}});await page.waitForTimeout(30);const gaps=await frame.evaluate(()=>effects.frames.slice(1).map((t,i)=>t-effects.frames[i]));return {worstMs:Math.max(...gaps),samples:gaps.length}});
 await step('pointerLock',async()=>{await page.getByRole('button',{name:'io_lock',exact:true}).click();await page.mouse.click(box.x+100,box.y+100);await frame.waitForFunction(()=>!!document.pointerLockElement);const locked=await frame.evaluate(()=>document.pointerLockElement.tagName);await page.keyboard.press('Escape');await frame.waitForFunction(()=>!effects.io);return {locked}});
 await page.keyboard.press('Escape');await frame.waitForFunction(()=>!effects.io);
 await step('latency',async()=>{await frame.evaluate(()=>{effects.inputFrames=[];let at=0;document.querySelector('canvas').addEventListener('pointermove',e=>at=e.timeStamp);fixture.scene.onAfterRenderObservable.add(()=>{if(at){effects.inputFrames.push(performance.now()-at);at=0}})});await drag(page,[box.x+box.width*.85,box.y+box.height*.8],[box.x+box.width*.85-80,box.y+box.height*.8+20],10);return frame.evaluate(()=>({samples:effects.inputFrames.length,maxMs:Math.max(...effects.inputFrames),meanMs:effects.inputFrames.reduce((a,b)=>a+b,0)/effects.inputFrames.length}))});
 await step('resizeMove',async()=>{await page.evaluate(()=>window.__alembic.select({shape:'sphere',center:[0,0,0],radius:.5,tag:'drag test'}));const handle=page.locator('.handles .dot').first(),before=await page.evaluate(()=>window.__alembic.selection().selections.at(-1));const h=await handle.boundingBox();await drag(page,[h.x+h.width/2,h.y+h.height/2],[h.x+35,h.y+10],5);await page.waitForTimeout(100);const resized=await page.evaluate(()=>window.__alembic.selection().selections.at(-1));assert.notDeepEqual(resized.radii||resized.radius,before.radii||before.radius);const p=await page.evaluate(()=>window.__alembic.project(window.__alembic.selection().selections.at(-1).center));await page.waitForFunction(([x,y,id])=>document.elementFromPoint(x,y)?.closest('[data-native-highlight]')?.dataset.nativeHighlight===id,[box.x+p[0],box.y+p[1],resized.id]);await drag(page,[box.x+p[0],box.y+p[1]],[box.x+p[0]+20,box.y+p[1]+15],4);await page.waitForTimeout(100);const moved=await page.evaluate(()=>window.__alembic.selection().selections.at(-1));assert.notDeepEqual(moved.center,resized.center);return {resize:true,move:true}});
 await step('handleLag',async()=>{await page.evaluate(()=>{window.handleDelays=[];window.handleErrors=[];addEventListener('message',e=>{if(e.data?.type!=='alembic.web.camera')return;const sent=e.data.at,selection=window.__alembic.selection().selections.at(-1);if(!selection?.center||selection.shape!=='sphere')return;const w=e.data.camera.world,r=w.slice(0,3),u=w.slice(4,7),R=[0,1,2].sort((a,b)=>Math.abs(r[b])-Math.abs(r[a]))[0],U=[0,1,2].filter(k=>k!==R).sort((a,b)=>Math.abs(u[b])-Math.abs(u[a]))[0],h=selection.radii||[selection.radius,selection.radius,selection.radius];const places=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];const expected=places.map(([i,j])=>{const p=[...selection.center],k=i&&j?Math.SQRT1_2:1;p[R]+=i*Math.sign(r[R])*h[R]*k;p[U]+=j*Math.sign(u[U])*h[U]*k;return window.__alembic.project(p)});requestAnimationFrame(()=>requestAnimationFrame(()=>{const dots=[...document.querySelectorAll('.handles .dot')];if(dots.length!==8)return;handleDelays.push(performance.timeOrigin+performance.now()-sent);handleErrors.push(Math.max(...dots.map((d,i)=>Math.hypot(parseFloat(d.style.left)-expected[i][0],parseFloat(d.style.top)-expected[i][1]))))}))})});await drag(page,[box.x+box.width*.9,box.y+box.height*.8],[box.x+box.width*.9-40,box.y+box.height*.8+10],5);await page.waitForTimeout(80);return page.evaluate(()=>({samples:handleDelays.length,twoFrameMaxMs:Math.max(...handleDelays),maxPixelError:Math.max(...handleErrors)}))});
 await step('boxPickDelete',async()=>{await page.evaluate(()=>window.__alembic.select({shape:'box',center:[0,0,0],size:[.4,.5,.6],tag:'box'}));const before=await page.evaluate(()=>window.__alembic.selection().selections.at(-1));await drag(page,[box.x+box.width*.85,box.y+box.height*.8],[box.x+box.width*.85-30,box.y+box.height*.8+10],4);assert.deepEqual((await page.evaluate(()=>window.__alembic.selection().selections.at(-1))).center,before.center);await page.getByRole('button',{name:'pick',exact:true}).click();const p=await page.evaluate(()=>window.__alembic.project([0,0,0]));await page.mouse.click(box.x+p[0],box.y+p[1]);await page.waitForFunction(()=>window.__alembic.selection().selections.at(-1)?.shape==='pick');const picked=await page.evaluate(()=>window.__alembic.selection().selections.at(-1));assert.ok(picked.objects.some(o=>o.name==='box'));await page.locator('.handles').focus();await page.keyboard.press('Delete');await page.waitForFunction(id=>!window.__alembic.selection().selections.some(s=>s.id===id),picked.id);return {worldAttached:true,objects:picked.objects,deleted:true}});
 await step('playback',async()=>{await page.locator('summary[aria-label="Playback"]').click();const item=page.getByRole('menuitem',{name:/Move/});assert.match(await item.innerText(),/1s/);await item.click();assert.equal(await frame.evaluate(()=>fixture.box.position.y),0);await page.getByRole('button',{name:'Play replay',exact:true}).click();await frame.waitForFunction(()=>fixture.box.position.y===1);await page.locator('summary[aria-label="Playback"]').click();await page.getByRole('button',{name:'Reset to inspect',exact:true}).click();await frame.waitForFunction(()=>fixture.box.position.y===0);return {effect:true,reset:true,duration:1}});
 await step('twoEscape',async()=>{if(!await page.locator('details.playback-menu').evaluate(e=>e.open))await page.locator('summary[aria-label="Playback"]').click();await page.getByRole('menuitem',{name:/Move/}).click();await page.getByRole('button',{name:'Play replay',exact:true}).click();await frame.waitForFunction(()=>fixture.box.position.y===1);await page.getByRole('button',{name:'io_lock',exact:true}).click();await frame.waitForFunction(()=>effects.io);await page.keyboard.press('Escape');await frame.waitForFunction(()=>!effects.io);assert.equal(await frame.evaluate(()=>fixture.box.position.y),1);await page.keyboard.press('Escape');await frame.waitForFunction(()=>fixture.box.position.y===0);return {firstReleasesInput:true,secondResetsPlayback:true}});
 await step('depth',async()=>{await page.evaluate(()=>window.__alembic.select({shape:'sphere',center:[0,0,0],radius:.2,tag:'depth'}));await page.waitForTimeout(80);const visible=await frame.locator('canvas').screenshot();await frame.evaluate(()=>fixture.scene.meshes.filter(m=>m.name==='volume').forEach(m=>m.setEnabled(false)));const hidden=await frame.locator('canvas').screenshot();assert.deepEqual(visible,hidden,'Geometry in front occludes the volume');await frame.evaluate(()=>fixture.scene.meshes.filter(m=>m.name==='volume').forEach(m=>m.setEnabled(true)));return {occluded:true}});
 await step('prompt',async()=>{const p=await page.evaluate(()=>window.__alembic.project([0,0,0]));await page.mouse.click(box.x+p[0],box.y+p[1],{button:'right'});await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();await page.locator('.node textarea').fill('Keep the box');await shot('prompt-iframe');return page.locator('.node').evaluate(e=>({html:e.outerHTML,style:{font:getComputedStyle(e).font,width:getComputedStyle(e).width},rect:e.getBoundingClientRect().toJSON()}))});
 await step('promptAnchor',async()=>{const before=await page.locator('.wire circle').evaluate(e=>[+e.getAttribute('cx'),+e.getAttribute('cy')]);await page.mouse.move(box.x+box.width*.2,box.y+box.height*.8);await page.keyboard.down('Shift');await page.mouse.down();await page.mouse.move(box.x+box.width*.2+60,box.y+box.height*.8+10,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');await page.waitForTimeout(60);const after=await page.locator('.wire circle').evaluate(e=>[+e.getAttribute('cx'),+e.getAttribute('cy')]),expected=await page.evaluate(()=>{const id=document.querySelector('.node').dataset.highlight;return window.__alembic.project(window.__alembic.selection().selections.find(s=>s.id===id).center)});assert.ok(Math.hypot(...after.map((v,i)=>v-before[i]))>1);const error=Math.hypot(...after.map((v,i)=>v-expected[i]));assert.ok(error<.01);return {pixelError:error}});
 await step('flat2d',async()=>{const previous=await page.locator('.viewport iframe').getAttribute('src');await page.getByRole('button',{name:'flat.i2d',exact:true}).click();await page.waitForFunction(()=>window.__alembic.state().file==='flat.i2d/index.html');const flat=await renderFrame(page,previous);await flat.waitForFunction(()=>window.effects);assert.deepEqual(await page.locator('[aria-label="Selection tools"] button').evaluateAll(a=>a.map(e=>e.getAttribute('aria-label'))),['area']);await page.getByRole('button',{name:'io_lock',exact:true}).click();await page.keyboard.press('k');await flat.waitForFunction(()=>effects.keys>0);await page.keyboard.press('Escape');await page.getByRole('button',{name:'area',exact:true}).click();const b=await page.locator('.viewport').boundingBox();await drag(page,[b.x+100,b.y+100],[b.x+250,b.y+220],4);await page.locator('.areas .dot').first().waitFor();return {tools:1,input:true,handles:await page.locator('.areas .dot').count()}});
}

// Real Vault app route, including the declared Godot HTML export.
async function enginesCheck({page,result,step,shot,file}) {
  page.setDefaultTimeout(6000);let frame,box;
  await step('modelGLB',async()=>{
    await page.getByRole('button',{name:'model.i3d',exact:true}).click();await page.waitForFunction(()=>window.__alembic?.state().kind==='model'&&window.__alembic.pose());
    await page.waitForFunction(()=>document.querySelector('.scene canvas')?.style.visibility!=='hidden');
    assert.match((await page.evaluate(()=>__alembic.state())).backend,/WebGPU/);await shot('blender-glb');
    await page.getByRole('button',{name:'pick',exact:true}).click();box=await page.locator('.viewport').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    await page.waitForFunction(()=>window.__alembic.selection().selections.at(-1)?.objects?.length>0);return page.evaluate(()=>__alembic.selection().selections.at(-1).objects);
  });
  await step('godot',async()=>{
    await page.getByRole('button',{name:'game.i3d',exact:true}).click();await page.waitForFunction(()=>window.__alembic?.state().file==='game.i3d/game.html'&&window.__alembic.pose());
    frame=page.frames().find(f=>f.url().includes('/app/'))||await page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/app/'),timeout:30000});await frame.waitForFunction(()=>window.godotFixture,null,{timeout:15000}).catch(async error=>{result.boot=await frame.evaluate(()=>({receive:typeof alembicGodotReceive,gpu:globalThis.alembicGodotGPU,resources:performance.getEntriesByType('resource').map(e=>({name:e.name.split('/').at(-1),size:e.decodedBodySize,duration:e.duration})),visibility:document.visibilityState}));throw error});await page.waitForTimeout(200);box=await page.locator('.viewport').boundingBox();return frame.evaluate(()=>alembicGodotGPU);
  });
  if(!frame||result.checks.godot?.failed)return;
  const select=async shape=>{await page.getByRole('button',{name:shape,exact:true}).click();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.waitForFunction(shape=>window.__alembic.selection().selections.at(-1)?.shape===shape,shape);return page.evaluate(()=>__alembic.selection().selections.at(-1))};
  await step('sphere',async()=>{const s=await select('sphere');assert.ok(s.objects.length);assert.ok(s.crop);assert.equal((await file(s.crop)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(await page.locator('.handles .dot').count(),8);return {objects:s.objects.length,crop:!!s.crop,handles:8}});
  await step('box',async()=>{const s=await select('box');assert.ok(s.objects.length);return {objects:s.objects.length,crop:!!s.crop}});
  await step('pick',async()=>{const s=await select('pick');assert.ok(s.objects.some(o=>o.name==='box'));return s.objects});
  await step('orbit',async()=>{const before=await page.evaluate(()=>__alembic.pose());await drag(page,[box.x+box.width*.8,box.y+box.height*.7],[box.x+box.width*.8-90,box.y+box.height*.7+30],8);await page.waitForTimeout(150);const after=await page.evaluate(()=>__alembic.pose());assert.notDeepEqual(before,after);await page.waitForTimeout(150);assert.deepEqual(await page.evaluate(()=>__alembic.pose()),after);return {moved:true,momentum:0}});
  await step('IO',async()=>{const before=await frame.evaluate(()=>godotFixture.x);await page.getByRole('button',{name:'io_lock',exact:true}).click();await frame.waitForFunction(()=>godotFixture.io);await page.keyboard.press('k');await frame.waitForFunction(x=>godotFixture.x>x,before);assert.equal(await page.locator('.handles .dot').count(),0);await page.keyboard.press('Escape');await frame.waitForFunction(()=>!godotFixture.io);const x=await frame.evaluate(()=>godotFixture.x);await page.keyboard.press('k');await page.waitForTimeout(100);assert.equal(await frame.evaluate(()=>godotFixture.x),x);return {gameMoved:true,inspectBlocksGameplay:true}});
  await step('pointerLock',async()=>{await page.getByRole('button',{name:'io_lock',exact:true}).click();await frame.waitForFunction(()=>godotFixture.io);box=await page.locator('.viewport').boundingBox();await page.mouse.click(box.x+100,box.y+100);try{await frame.waitForFunction(()=>!!document.pointerLockElement)}finally{await page.keyboard.press('Escape');await frame.waitForFunction(()=>!godotFixture.io&&!document.pointerLockElement)}return {captured:true,released:true}});
  await step('depthCapture',async()=>{await page.evaluate(()=>__alembic.select({shape:'sphere',center:[0,0,0],radius:.1,tag:'inside'}));await page.waitForTimeout(500);const visible=await frame.evaluate(()=>document.querySelector('canvas').toDataURL());await frame.evaluate(()=>alembicGodotReceive(JSON.stringify({type:'alembic.web.draw',shapes:[],style:{color:'#e28a67',alpha:.18}})));await page.waitForTimeout(100);assert.equal(await frame.evaluate(()=>document.querySelector('canvas').toDataURL()),visible);return {occluded:true}});
  await step('playbackMenu',async()=>{
    await page.locator('summary[aria-label="Playback"]').click();
    const item=page.getByRole('menuitem',{name:/^Move/});assert.match(await item.innerText(),/2s/);
    await item.click();await frame.waitForFunction(()=>godotFixture.y===1);
    await page.locator('summary[aria-label="Playback"]').click();
    await page.getByRole('button',{name:'Reset to inspect',exact:true}).click();
    await frame.waitForFunction(()=>godotFixture.y===0);return {moved:true,reset:true,actualMenu:true};
  });
  await step('prompt',async()=>{await page.getByRole('button',{name:'sphere',exact:true}).click();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.mouse.click(box.x+box.width*.2,box.y+box.height*.7,{button:'right'});await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();await page.locator('.node textarea').fill('Keep the box');await shot('godot-prompt');return {draft:await page.locator('.node textarea').inputValue(),send:'draft only; terminal delivery covered by the GLB checks'}});
  await step('promptAnchor',async()=>{const anchor=()=>page.locator('.wire circle').evaluate(e=>[+e.getAttribute('cx'),+e.getAttribute('cy')]);const before=await anchor();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.8);await page.keyboard.down('Shift');await page.mouse.down();await page.mouse.move(box.x+box.width*.8+60,box.y+box.height*.8+10,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');await page.waitForTimeout(150);const after=await anchor(),expected=await page.evaluate(()=>__alembic.project(__alembic.selection().selections.find(s=>s.id===document.querySelector('.node').dataset.highlight).center));assert.ok(Math.hypot(...after.map((v,i)=>v-before[i]))>1);assert.ok(Math.hypot(...after.map((v,i)=>v-expected[i]))<.01);return {worldAttached:true}});
  await step('noDOMOverlay',async()=>{const texts=await frame.evaluate(()=>[...document.body.children].filter(e=>!['CANVAS','SCRIPT','STYLE'].includes(e.tagName)&&e.textContent.trim()).map(e=>e.textContent));assert.deepEqual(texts,[]);return true});
}

// The directory and the node's own indexes are the entire fixture registry.
async function playbackCheck({page,step,result,file}) {
  page.setDefaultTimeout(6000);
  await page.context().addInitScript(()=>{
    window.__mockAudio=[];const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(target,...ports){
      if(target===this.context.destination){
        const analyser=new AnalyserNode(this.context);window.__mockAudio.push(analyser);
        connect.call(this,analyser);return connect.call(analyser,target,...ports);
      }
      return connect.call(this,target,...ports);
    };
  });
  const root=process.env.ALEMBIC_MOCK ? pathToFileURL(process.env.ALEMBIC_MOCK+'/') :
    new URL('./mock/',import.meta.url), nodes=[];
  // Authored examples have arbitrary lengths/static scripts: the skills case checks those.
  for(const group of await readdir(root,{withFileTypes:true}))if(group.isDirectory()&&['i3d','i2d','audio','iframe','invalid'].includes(group.name))
    for(const node of await readdir(new URL(group.name+'/',root),{withFileTypes:true}))if(node.isDirectory())
      nodes.push({group:group.name,name:node.name,path:group.name+'/'+node.name});
  const menu=page.locator('details.playback-menu'), summary=page.locator('summary[aria-label="Playback"]');
  const showMenu=async()=>{if(!await menu.evaluate(e=>e.open))await summary.click()};
  const ready=async (path,previous='')=>{
    await page.waitForFunction(path=>window.__alembic?.state().file.startsWith(path+'/'),path);
    if(/\.(glb|gltf)$/.test((await page.evaluate(()=>__alembic.state())).file)){
      await page.waitForFunction(()=>__alembic.state().kind==='model'&&__alembic.pose()&&document.querySelector('.scene canvas')?.style.visibility!=='hidden');return null;
    }
    return renderFrame(page,previous);
  };
  const silent=()=>{const a=document.querySelector('audio');return (!a||a.paused&&a.currentTime===0)&&window.__mockAudio.every(n=>{if(n.context.state==='closed')return true;const d=new Float32Array(128);n.getFloatTimeDomainData(d);return d.every(v=>Math.abs(v)<.00001)})};
  const hear=async frame=>{
        await frame.evaluate(()=>{
          const audio=document.querySelector('audio');if(!audio)return;
          const context=new AudioContext();context.createMediaElementSource(audio).connect(context.destination);context.resume();
        });
        await frame.waitForFunction(()=>{return window.__mockAudio.some(analyser=>{if(analyser.context.state!=='running')return false;const samples=new Float32Array(128);analyser.getFloatTimeDomainData(samples);return samples.some(n=>Math.abs(n)>0.00001)})});
  };
  const pixels=()=>page.locator('.viewport').screenshot();
  const source=()=>page.locator('.viewport iframe').evaluateAll(frames=>frames[0]?.getAttribute('src')||'');
  await step('mockTreeAndHardware',async()=>{
    for(const group of new Set(nodes.map(n=>n.group)))await page.locator('button.row').filter({has:page.locator('span',{hasText:new RegExp('^'+group+'$')})}).click();
    for(const node of nodes)await page.getByRole('button',{name:node.name,exact:true}).waitFor();
    result.gpu=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});return {vendor:a?.info.vendor,description:a?.info.description,architecture:a?.info.architecture,fallback:a?.isFallbackAdapter||a?.info.isFallbackAdapter||false}});
    assert.ok(result.gpu.vendor);assert.equal(result.gpu.fallback,false);
    assert.doesNotMatch(JSON.stringify(result.gpu),/swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i);
    const terminal=page.locator('.native-agent-terminal .xterm-helper-textarea');await terminal.focus();await page.keyboard.type('./codex\r');await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-ready'));
    return {nodes:nodes.length,gpu:result.gpu};
  });
  for(const node of nodes.sort((a,b)=>(a.group==='invalid')-(b.group==='invalid')))await step(node.path.replaceAll('/','-'),async()=>{
    const previous=await source();
    await page.getByRole('button',{name:node.name,exact:true}).click();
    if(node.group==='invalid'){
      await page.waitForFunction(()=>[...document.querySelectorAll('.status,[role=status]')].some(e=>/WebGL\/WebGPU context|visible DOM text|Live godot child|Stream renderer is unavailable|render format/i.test(e.textContent)));
      // A forbidden dependency's rejected fetch is part of its visible failure.
      result.errors=result.errors.filter(e=>!e.includes('Live godot child')&&!e.includes('/_deps/child/game.html'));
      return {failedVisibly:true};
    }
    let frame=await ready(node.path,previous);
    const tools=await page.locator('[aria-label="Selection tools"] button').evaluateAll(a=>a.map(e=>e.getAttribute('aria-label')));
    assert.deepEqual(tools,node.group==='i3d'?['area','sphere','box','pick']:['area']);
    let before,colors;
    for(let attempt=0;attempt<20;attempt++){
      before=await pixels();colors=await page.evaluate(async png=>{
        const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();const c=new OffscreenCanvas(64,64),ctx=c.getContext('2d');ctx.drawImage(image,0,0,64,64);
        const p=ctx.getImageData(0,0,64,64).data,s=new Set();for(let i=0;i<p.length;i+=4)s.add(p.slice(i,i+3).join(','));return s.size;
      },before.toString('base64'));
      if(colors>1)break;await page.waitForTimeout(100);
    }
    assert.ok(colors>1,'Rendered nonblank pixels');
    if(node.group==='iframe'){
      const io=page.getByRole('button',{name:'io_lock',exact:true}),b=await page.locator('.viewport').boundingBox();
      await frame.getByRole('button',{name:'Click',exact:true}).click({trial:true,timeout:300}).then(()=>assert.fail('Inspection accepted frame input'),()=>{});
      await io.click();await page.keyboard.press('k');await frame.waitForFunction(()=>keys>0);await frame.getByRole('button',{name:'Click',exact:true}).click();assert.equal(await frame.evaluate(()=>clicks),1);
      await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('[aria-label=io_lock]').getAttribute('aria-pressed')==='false');
      await page.getByRole('button',{name:'area',exact:true}).click();await drag(page,[b.x+80,b.y+80],[b.x+240,b.y+240],5);await page.locator('.area.active .edge.top').waitFor();
      const receipts=await page.locator('.xterm-rows').innerText().then(s=>(s.match(/fixture-agent-received/g)||[]).length);
      await page.locator('.area.active .edge.top').click();await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();await page.locator('.node textarea').fill('Review '+node.name);await page.locator('.node').getByRole('button',{name:'Send',exact:true}).click();
      await page.waitForFunction(n=>(document.querySelector('.xterm-rows')?.textContent.match(/fixture-agent-received/g)||[]).length>n,receipts);
      const line=(await file('prompt.txt')).toString();assert.ok(line.includes(node.name));const context=JSON.parse(await file(line.match(/details: ([^)]+)\)/)[1]));assert.equal(context.selection.shape,'area');
      return {io:true,input:true,escape:true,prompt:true,area:true,blackBox:true,restored:true};
    }
    const rows=(await readFile(new URL(node.path+'/playbacks.txt',root),'utf8')).trim().split('\n').slice(1).map(line=>{const [,id,label,render,length]=line.split('\t');return {id,label,render,length}});
    const renders=(await readFile(new URL(node.path+'/exports.txt',root),'utf8')).split('\n').map(l=>l.split('\t')).filter(r=>r[0]==='render');
    const starting=(await page.evaluate(()=>__alembic.state())).file,changes=[];
    await showMenu();await page.waitForFunction(count=>document.querySelectorAll('[role=menuitem]').length===count,rows.length);await summary.click();
    for(const row of rows){
      const prior=await source();
      await showMenu();const item=page.getByRole('menuitem').filter({hasText:row.label+' ·'});await item.waitFor();
      assert.ok((await item.innerText()).includes(row.length==='unknown'?'duration unknown':row.length+'s'));await item.click();
      const entry=renders.find(r=>r[1]===row.render)[3];
      await page.waitForFunction(file=>__alembic.state().file===file,node.path+'/'+entry);frame=await ready(node.path,node.path+'/'+entry===starting?'':prior);
      await page.waitForFunction(()=>document.querySelector('details.playback-menu')?.open===false);
      const play=page.getByRole('button',{name:'Play replay',exact:true}),position=page.locator('input[aria-label="Replay position"]');
      await page.waitForFunction(()=>document.querySelector('[aria-label="Play replay"]')?.disabled===false);assert.equal(await play.isEnabled(),true);await page.waitForTimeout(100);assert.equal(await position.inputValue(),'0');
      const armed=await pixels();if(node.group!=='audio'&&row.render===renders[0][1])assert.deepEqual(armed,before,'Choosing leaves starting pixels unchanged');
      if(node.group==='audio')assert.ok(await frame.evaluate(silent),'Choosing is silent');
      if(row===rows[0]){await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('[aria-label="Play replay"]').disabled);assert.equal((await page.evaluate(()=>__alembic.state())).file,starting);
        await showMenu();await item.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Play replay"]').disabled===false);frame=await ready(node.path);assert.equal(await position.inputValue(),'0');}
      await play.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Pause replay"]')?.disabled===false);
      const time=page.locator('.transport .time'),first=await time.innerText();await page.waitForTimeout(100);assert.notEqual(await time.innerText(),first,'Timeline counts up');
      if(row.length!=='unknown'){
        await page.waitForFunction(length=>Number(document.querySelector('input[aria-label="Replay position"]').max)===length,Number(row.length));
        const length=Number(row.length);
        await page.locator('input[aria-label="Replay position"]').evaluate((input,length)=>{input.value=String(length*.99);input.dispatchEvent(new Event('input',{bubbles:true}))},length);
        await page.waitForFunction(length=>Number(document.querySelector('input[aria-label="Replay position"]').value)<length*.9,length);
      }
      const running=await source();
      if(node.group==='audio'){await hear(frame);
      }else{
        await page.waitForTimeout(100);changes.push(!armed.equals(await pixels()));if(node.name!=='model.i3d')assert.ok(changes.at(-1),'Play produces the script effect');
      }
      if(row.length==='unknown'){
        assert.match(await time.innerText(),/\/ —$/);await page.getByRole('button',{name:'Pause replay',exact:true}).click();const frozen=await position.inputValue();
        await page.waitForTimeout(70);assert.equal(await position.inputValue(),frozen,'Pause freezes only the bar');await page.getByRole('button',{name:'Next frame',exact:true}).click();await page.waitForFunction(t=>Number(document.querySelector('[aria-label="Replay position"]').value)>t,Number(frozen));
        await page.waitForTimeout(Math.max(...rows.filter(r=>r.length!=='unknown').map(r=>Number(r.length)))*1000+100);
        assert.ok(Number(await position.inputValue())>Math.max(...rows.filter(r=>r.length!=='unknown').map(r=>Number(r.length))));
        await page.keyboard.press('Escape');
      }else{
        await page.waitForFunction(()=>!document.querySelector('[aria-label="Play replay"]').disabled&&document.querySelector('[aria-label="Replay position"]').value==='0',null,{timeout:4000});
        frame=await ready(node.path);if(node.group==='audio')await frame.waitForFunction(silent);else assert.deepEqual(await pixels(),armed,'Timed end restores selected render while armed');
        await play.click();await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Replay position"]').value)>0);
        if(node.group==='audio')await hear(frame);
        if(node.group!=='audio'&&node.name!=='model.i3d')assert.notDeepEqual(await pixels(),armed,'Play runs the effect again');
        await showMenu();await page.getByRole('button',{name:'Reset to inspect',exact:true}).click();
      }
      await page.waitForFunction(()=>document.querySelector('[aria-label="Play replay"]').disabled);
      await page.waitForFunction(file=>__alembic.state().file===file,starting);frame=await ready(node.path,node.path+'/'+entry===starting?'':running);
      if(await menu.evaluate(e=>e.open))await summary.click();
      if(node.group==='audio'){
        if(frame)await frame.waitForFunction(()=>{const audio=document.querySelector('audio');return audio?audio.currentTime===0:window.__mockAudio.length&&window.__mockAudio.every(analyser=>{if(analyser.context.state==='closed')return true;const data=new Float32Array(128);analyser.getFloatTimeDomainData(data);return data.every(n=>Math.abs(n)<0.00001)})});
        if(frame)await frame.evaluate(()=>{if(document.querySelector('audio'))return Promise.all([...new Set(window.__mockAudio.map(a=>a.context))].filter(c=>c.state!=='closed').map(c=>c.close()))});
      }else {await page.waitForTimeout(70);assert.deepEqual(await pixels(),before,'Stop restores the starting render and pixels');}
      for(const f of page.frames())assert.doesNotMatch(await f.locator('body').innerText().catch(()=>''),/"error":"Not found"/);
    }
    return {colors,tools,changes,rows:rows.length,timed:rows.filter(r=>r.length!=='unknown').length,unknown:true,restored:true};
  });
  await step('fileClipArmsAndSeeks',async()=>{
    await page.evaluate(()=>__alembic.open('i3d/animated.i3d/scene.glb'));await ready('i3d/animated.i3d');const before=await pixels();
    await showMenu();await page.getByRole('menuitemradio',{name:'Translate',exact:true}).click();await page.waitForTimeout(100);
    const position=page.locator('[aria-label="Replay position"]'),play=page.getByRole('button',{name:'Play replay',exact:true});assert.equal(await position.inputValue(),'0');assert.ok(await play.isEnabled());assert.deepEqual(await pixels(),before);
    await play.click();await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Replay position"]').value)>0);await position.evaluate(e=>{e.value=String(Number(e.max)*.5);e.dispatchEvent(new Event('input',{bubbles:true}))});const halfway=Number(await position.getAttribute('max'))*.5;await page.waitForTimeout(100);assert.ok(Math.abs(Number(await position.inputValue())-halfway)<.001,'File clips retain seeking');assert.notDeepEqual(await pixels(),before);return {armed:true,plays:true,seeks:true};
  });
  await step('declaredLengthDrivesTimeline',()=>{assert.ok(nodes.filter(n=>n.group!=='invalid').every(n=>result.checks[n.path.replaceAll('/','-')]?.restored));return {armsWithoutPlaying:true,advances:true,snapsBack:true,endsArmed:true,replays:true,unknownUntilStopped:true}});
}

async function typesCheck({page,step}) {
  page.setDefaultTimeout(20000);
  for(const node of ['box.i3d','game.i3d'])for(const pseudo of ['before','after'])await step(node+'::'+pseudo,async()=>{
    await page.reload();await page.getByRole('button',{name:node,exact:true}).click();
    const frame=await renderFrame(page);
    await frame.waitForFunction(()=>window.fixture||window.godotFixture,null,{timeout:20000});
    await frame.evaluate(pseudo=>{
      const style=document.createElement('style');
      style.textContent=`body::${pseudo}{content:"Forbidden CSS HUD";position:fixed;top:20px;left:20px;color:white;z-index:2}`;
      document.head.append(style);
    },pseudo);
    await page.waitForFunction(()=>[...document.querySelectorAll('.status,[role=status]')]
      .some(e=>e.textContent.includes('visible DOM text')));
    return {failedVisibly:true};
  });
}

function embedCheck(context) {
  return {app:appCheck,dev:devCheck,self:selfCheck,capture:captureCheck}[process.env.ALEMBIC_EMBED_CASE||'app'](context);
}
async function appCheck({page,result,step,shot,file}) {
 let app,box,lateSession;
 await step('iframeReady',async()=>{
  await page.waitForFunction(()=>window.__alembic?.state().kind==='app');
  await page.waitForFunction(()=>document.querySelector('.viewport iframe')?.style.visibility==='visible');
  app=await renderFrame(page);await app.waitForFunction(()=>window.__alEmbedded&&window.effects);box=await page.locator('.viewport').boundingBox();
  return {crossOrigin:new URL(app.url()).origin!==new URL(page.url()).origin};
 });if(!app)return;
 await step('ioOffBlocksInput',async()=>{const n=await app.evaluate(()=>effects.clicks);await app.locator('#click').click({force:true});assert.equal(await app.evaluate(()=>effects.clicks),n);return {blocked:true}});
 await step('ioOnRealClickAndKeysEscape',async()=>{
  await page.getByRole('button',{name:'io_lock',exact:true}).click();await app.locator('#click').click();await app.locator('#keys').click();await page.keyboard.type('hello');
  assert.equal(await app.locator('#keys').inputValue(),'hello');assert.equal(await app.evaluate(()=>effects.clicks),1);assert.ok(await app.evaluate(()=>effects.keys)>=5);
  await page.keyboard.press('Escape');await app.waitForFunction(()=>!__alEmbedded.binding.state.io_lock);return {clicks:1,text:'hello',escapeReleased:true};
 });
 await step('realEmbeddedPrompt',async()=>{
  const terminal=page.locator('.native-agent-terminal .xterm-helper-textarea');await terminal.focus();if(process.env.ALEMBIC_LATE_AGENT){const c=new URLSearchParams(new URL(process.env.ALEMBIC_URL).hash.slice(1));const r=await page.request.post(c.get('node')+'/vms/local/launch',{headers:{Authorization:'Bearer '+c.get('token')},data:{agent:'./codex'}});assert.equal(r.status(),200);lateSession=(await r.json()).id}else{if(!process.env.ALEMBIC_ATTACHED)await page.keyboard.type('./codex\r',{delay:8});await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-ready'))}
  await page.getByRole('button',{name:'area',exact:true}).click();const b=await page.locator('.viewport').boundingBox();
  await drag(page,[b.x+20,b.y+60],[b.x+380,b.y+240],6);await page.locator('.areas .dot').first().waitFor();
  await page.locator('.area.active .edge.top').click({button:'right'});await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();const text='Make this exact area blue'+(process.env.ALEMBIC_ATTACHED?' attached':'');await page.locator('.node textarea').fill(text);await page.locator('.node').getByRole('button',{name:'Send',exact:true}).click();
  if(!process.env.ALEMBIC_LATE_AGENT)await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-received'));
  let line='';for(let i=0;i<60;i++){try{line=(await file('prompt.txt')).toString()}catch{}if(line.includes(text))break;await page.waitForTimeout(50)}assert.match(line,/Make this exact area blue/);const doc=JSON.parse(await file(line.match(/details: ([^)]+)\)/)[1]));assert.equal(doc.prompt,text);if(lateSession)assert.equal((await file('receiver-session.txt')).toString(),lateSession,'Prompt reached the last-focused session');assert.equal(doc.selection.shape,'area');assert.ok(doc.selection.objects.length);assert.ok(doc.selection.objects.some(o=>o.id==='state'),'State name accompanies the highlight');if(process.env.ALEMBIC_ATTACHED)assert.ok(line.startsWith('\x1b[200~'),'Bracketed paste reached attached PTY');assert.ok(doc.selection.crop,'Actual canvas crop');
  assert.equal((await file(doc.selection.crop)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');await shot('embedded-prompt');return {ptyReceived:true,attached:!!process.env.ALEMBIC_ATTACHED,lastFocused:!!process.env.ALEMBIC_LATE_AGENT,objects:doc.selection.objects,crop:true};
 });
 await step('browserReattach',async()=>{await page.reload();await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-ready'));const config=new URLSearchParams();return {replayedRealPty:true}});
 if(process.env.ALEMBIC_FOLDER_EDIT)await step('sourceFrameReload',async()=>{
  const path=process.env.ALEMBIC_FOLDER_EDIT,source=await readFile(path,'utf8');
  try{await writeFile(path,source.replace('</body>','<p id="source-reloaded">Real source reload</p></body>'));await page.waitForFunction(()=>document.querySelector('.viewport iframe')?.style.visibility==='visible');await page.waitForTimeout(1600);const frame=page.frames().find(f=>f.url().includes('/app/'));await frame.locator('#source-reloaded').waitFor();return {sourceActuallyReloaded:true}}finally{await writeFile(path,source)}
 });
}
async function devCheck({page,step}){
 let app;
 await step('devProxyReady',async()=>{await page.waitForFunction(()=>document.querySelector('.viewport iframe')?.style.visibility==='visible');app=await renderFrame(page);await app.waitForFunction(()=>window.devVersion==='one');return {realModuleLoaded:true}});
 if(!app)return;
 await step('sourceHotReload',async()=>{
  const source=await readFile(process.env.ALEMBIC_EDIT,'utf8');
  try{await writeFile(process.env.ALEMBIC_EDIT,source.replace("'one'","'two'"));await app.waitForFunction(()=>window.devVersion==='two');return {moduleActuallyReplaced:true}}
  finally{await writeFile(process.env.ALEMBIC_EDIT,source)}
 });
}
async function selfCheck({page,step}){
 let app;
 await step('embeddedFrontend',async()=>{
  await page.waitForFunction(()=>document.querySelector('.viewport iframe')?.style.visibility==='visible');app=await renderFrame(page);await app.waitForFunction(()=>window.__alembic?.connectionReadiness().rootTreeListed);
  await app.getByRole('button',{name:'sample.iframe',exact:true}).waitFor();await app.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('mock-session-ready'));return {nestedRealFrontend:true,mockTerminalReplayed:true};
 });if(!app)return;
 await step('playbackChangesMockPeer',async()=>{
  await page.locator('summary[aria-label="Playback"]').click();await page.getByRole('menuitem',{name:/^i2d-success/}).waitFor();await page.getByRole('menuitem',{name:/^i2d-success/}).click();
  await app.waitForFunction(()=>document.body.dataset.state==='i2d-success');await app.getByRole('button',{name:'sample.i2d',exact:true}).waitFor();assert.equal(await app.getByRole('button',{name:'sample.iframe',exact:true}).count(),0);return {states:16,treeActuallyChanged:true};
 });
}
async function captureCheck({page,step}){
 await step('captureFailureIsVisible',async()=>{
  await page.waitForFunction(()=>document.querySelector('.viewport iframe')?.style.visibility==='visible');const app=await renderFrame(page);
  await app.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=()=>{throw Error('App canvas readback unavailable')}});
  await page.getByRole('button',{name:'area',exact:true}).click();const b=await page.locator('.viewport').boundingBox();await drag(page,[b.x+20,b.y+60],[b.x+380,b.y+240],4);
  await page.waitForFunction(()=>[...document.querySelectorAll('[role=status],.status')].some(e=>e.textContent.includes('App canvas readback unavailable')));return {failedVisibly:true};
 });
}

async function stateCheck({page,result,step}) {
 const config=new URLSearchParams(new URL(process.env.ALEMBIC_URL).hash.slice(1)),headers={Authorization:'Bearer '+config.get('token')};
 await step('stateReady',async()=>{await page.waitForFunction(()=>window.__alembic?.connectionReadiness().rootTreeListed);await page.locator('.native-agent-terminal .xterm-screen').waitFor();await page.waitForFunction(()=>document.querySelector('.viewport iframe')?.style.visibility==='visible');await page.waitForFunction(()=>document.querySelector('.connection-dot.on'))});
 const state=JSON.parse(await readFile(new URL('./states/'+process.env.ALEMBIC_STATE+'.json',import.meta.url),'utf8'));
 for(const [i,action] of state.steps.entries())await step('recorded-'+i,async()=>{
  if(action.kind==='backend'){
   const route=action.operation.startsWith('/')?action.operation:'/w/project/'+action.operation,response=await page.request.get(config.get('node')+route,{headers});assert.equal(response.status(),action.status||200);return {status:response.status()};
  }
  if(action.kind==='render'){
   const response=await page.evaluate(action=>new Promise((resolve,reject)=>{
    const frame=document.querySelector('.viewport iframe'),url=new URL(frame.src),id='recorded-step',session=new URLSearchParams(url.hash.slice(1)).get('session');
    const timer=setTimeout(()=>{removeEventListener('message',listener);reject(Error('Recorded render step timed out'))},5000);
    const listener=e=>{if(e.source===frame.contentWindow&&e.origin===url.origin&&e.data?.id===id){clearTimeout(timer);removeEventListener('message',listener);resolve(e.data)}};addEventListener('message',listener);
    frame.contentWindow.postMessage({type:'alembic.web.'+(action.operation==='reset'?'reset':'render'),id,session,...action},url.origin);
   }),action);assert.equal(response.ok,action.ok!==false);return {ok:response.ok};
  }
  throw Error('Unknown recorded step');
 });
 if(process.env.ALEMBIC_STYLE_DRIFT)await page.addStyleTag({content:'body{font-size:29px!important;padding:9px!important}'});
 const journal=await (await page.request.get(config.get('node')+'/al/log',{headers})).json();
 const dom=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>!e.closest('.xterm-screen')&&!['SCRIPT','STYLE'].includes(e.tagName)).map(e=>{const s=getComputedStyle(e);return [e.tagName,e.childElementCount,e.getAttribute('role'),e.getAttribute('aria-label'),e.disabled??null,...['display','position','font','color','backgroundColor','padding','margin','border','width','height'].map(k=>s[k])]}));
 const screenshot=await page.screenshot({path:resolve(process.env.ALEMBIC_OUT,'state.png')});
 const pixels=await page.evaluate(async bytes=>{const img=new Image();img.src='data:image/png;base64,'+bytes;await img.decode();const c=document.createElement('canvas');c.width=28;c.height=17;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,28,17);return [...ctx.getImageData(0,0,28,17).data]},screenshot.toString('base64'));
 await writeFile(resolve(process.env.ALEMBIC_OUT,'state.json'),JSON.stringify({dom,pixels,consoleErrors:result.errors,funnelMessages:journal.filter(e=>['frontend','reply','renderer'].includes(e.kind)),steps:result.checks,state:process.env.ALEMBIC_STATE}));
 if(process.env.ALEMBIC_BASELINE)await step('frozen',async()=>{
  const baseline=JSON.parse(await readFile(process.env.ALEMBIC_BASELINE,'utf8'));assert.deepEqual(dom,baseline.dom,'DOM, styles and enabled controls drifted');
  const changed=pixels.reduce((n,v,i)=>n+(Math.abs(v-baseline.pixels[i])>baseline.tolerance),0)/pixels.length;assert.ok(changed<=baseline.maxChanged,`Pixel drift ${changed} exceeds ${baseline.maxChanged}`);return {changed};
 });
}

// Run unchanged against main's copied build and this build, both on backend/server.py.
async function promptCheck({page,result,step,file}) {
 await page.context().addInitScript(()=>{let n=0;crypto.randomUUID=()=> '00000000-0000-4000-8000-'+String(++n).padStart(12,'0')});
 await page.reload();
 await step('terminalCommand',async()=>{
  await page.waitForFunction(()=>/\$\s*$/.test(document.querySelector('.xterm-rows')?.textContent||''));
  const terminal=page.locator('.native-agent-terminal .xterm-helper-textarea');await terminal.focus();await page.keyboard.type("printf task20-command-ok > command.txt; printf task20-ready-; printf 'terminal\\n'\r",{delay:5});
  await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('task20-ready-terminal'));assert.equal((await file('command.txt')).toString(),'task20-command-ok');
  await page.keyboard.type('./codex\r',{delay:5});await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-ready'));return {commandExecuted:true};
 });
 await step('promptPayload',async()=>{
  await page.getByRole('button',{name:'model.i3d',exact:true}).click();await page.waitForFunction(()=>window.__alembic?.state().kind==='model'&&window.__alembic.pose());
  await page.waitForFunction(()=>document.querySelector('.scene canvas')?.style.visibility!=='hidden');
  const selection=await page.evaluate(async()=>{await window.__alembic.select({shape:'sphere',center:[.35,-.25,0],radius:.4,tag:'parity'});return window.__alembic.selection().selections.at(-1)});
  assert.ok(selection.objects.length,'Actual model intersections');assert.ok(selection.crop,'Actual renderer crop');
  const b=await page.locator('.viewport').boundingBox(),p=await page.evaluate(()=>window.__alembic.project([.35,-.25,0]));
  await page.mouse.click(b.x+p[0],b.y+p[1],{button:'right'});await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();
  await page.locator('.node textarea').fill('Keep this highlight attached\nExact payload parity');
  const card=await page.locator('.node header').boundingBox();await drag(page,[card.x+80,card.y+15],[card.x+110,card.y+35],4);
  await page.locator('.node').getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('fixture-agent-received'));
  const line=(await file('prompt.txt')).toString(),path=line.match(/details: ([^)]+)\)/)?.[1];assert.ok(path,line);
  const context=(await file(path)).toString(),doc=JSON.parse(context);assert.match(line,/Node model\.i3d; view GLB/);assert.equal(doc.file,'model.i3d/model.glb');assert.equal(doc.canvas.path,'model.i3d');assert.equal(doc.version,1);assert.deepEqual(doc.selection,selection);
  assert.equal((await file(doc.selection.crop)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  await writeFile(resolve(process.env.ALEMBIC_OUT,'payload.json'),JSON.stringify({line,context}));return {terminalReceived:true,geometry:true,crop:true,contextBytes:context.length};
 });
}

async function securityCheck({page,step}) {
  const config=new URLSearchParams(new URL(process.env.ALEMBIC_URL).hash.slice(1));
  const controller=config.get('node'),preview=config.get('preview'),secret=config.get('token');
  await page.waitForFunction(()=>document.querySelector('.viewport iframe')?.style.visibility==='visible');
  const frame=page.frames().find(f=>f.url().includes('/app/'));
  await step('devCannotServeCredentials',async()=>{
    const paths=['/@fs/'+process.env.ALEMBIC_SECRET_PATH,'/%40fs/etc/passwd',
      '/a/%2e%2e/@fs/etc/passwd','/%2540fs/etc/passwd','/%5c@fs/etc/passwd'];
    for(const origin of [controller,preview])for(const path of paths){
      const response=await page.request.get(origin+path,{headers:{Origin:preview}});
      assert.equal(response.status(),403);
      assert.ok(!(await response.body()).includes(Buffer.from(secret)));
    }
    const probe=await frame.evaluate(async url=>{
      try{const response=await fetch(url,{mode:'no-cors'});return {type:response.type,body:await response.text()};}
      catch{return {type:'blocked',body:''};}
    },controller+paths[0]);
    assert.ok(['opaque','blocked'].includes(probe.type));assert.equal(probe.body,'');return {paths:10,rendererCannotRead:true};
  });
  await step('rendererJournalRefused',async()=>{
    for(const origin of ['https://wrong.example',preview]){
      const response=await page.request.post(preview+'/__al/message',{headers:{Origin:origin},data:{x:1}});
      assert.equal(response.status(),403);
    }
    return {refused:2};
  });
  await step('staticFrontendIsVerbatim',async()=>{
    for(const file of ['bridge.js','app-tools.js']){
      const expected=await readFile(new URL('../frontend/dist/assets/play/'+file,import.meta.url));
      for(const origin of [controller,preview]){
        const response=await page.request.get(origin+'/assets/play/'+file);
        assert.equal(response.status(),200);assert.deepEqual(await response.body(),expected);
      }
    }
    return {identicalResponses:4};
  });
}

// Control: trusted clicks in the same Windows headless harness as engine checks.
async function pointerCheck({page,step}) {
 const origin=new URL(page.url()).origin, other=origin.replace('127.0.0.1','localhost');
 const document='<canvas width="300" height="200"></canvas><script>document.querySelector("canvas").onclick=async function(){try{await this.requestPointerLock();window.lockResult={locked:document.pointerLockElement===this}}catch(e){window.lockResult={error:e.name+": "+e.message}}}</script>';
 await page.route('**/pointer-control*',r=>r.fulfill({contentType:'text/html',body:document}));
 for(const framed of [false,true])await step(framed?'pointerCrossOrigin':'pointerTopLevel',async()=>{
  await page.goto(origin+'/pointer-control');
  const navigation=framed?page.waitForEvent('framenavigated',{predicate:f=>f.url().startsWith(other)}):null;
  if(framed)await page.evaluate(src=>{const f=document.createElement('iframe');f.src=src;document.body.replaceChildren(f)},other+'/pointer-control');
  const frame=framed?await navigation:page;
  await frame.locator('canvas').click();await frame.waitForFunction(()=>window.lockResult);
  const result=await frame.evaluate(()=>window.lockResult);assert.ok(result.locked||result.error?.startsWith('WrongDocumentError:'),JSON.stringify(result));
  if(result.locked)await frame.evaluate(()=>document.exitPointerLock());return result;
 });
}

export async function drag(page, from, to, steps) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to,{steps});
  await page.mouse.up();
}
