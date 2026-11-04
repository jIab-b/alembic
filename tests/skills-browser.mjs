// Real authored nodes: use their own declarations, including long/static scenarios.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readExports,readPlaybacks,validateRenderEffect} from '../frontend/src/contract/rules.js';
import {observeEffect} from '../frontend/src/contract/effect.js';
import {renderFrame} from './render-frame.mjs';

export async function check(context) {
  const {page,step}=context;
  page.setDefaultTimeout(15000);
  await page.context().addInitScript(()=>{
    window.__skillContexts=[];window.__skillAudio=[];
    for(const type of [HTMLCanvasElement,globalThis.OffscreenCanvas].filter(Boolean)){
      const original=type.prototype.getContext;
      type.prototype.getContext=function(name,...args){
        const result=original.call(this,name,...args);
        if(result&&/^(webgl2?|webgpu)$/.test(name))window.__skillContexts.push(name);
        return result;
      };
    }
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(target,...ports){
      if(target===this.context.destination){
        const analyser=new AnalyserNode(this.context);window.__skillAudio.push(analyser);
        connect.call(this,analyser);return connect.call(analyser,target,...ports);
      }
      return connect.call(this,target,...ports);
    };
  });
  await page.reload();
  const root=process.env.ALEMBIC_MOCK ? pathToFileURL(process.env.ALEMBIC_MOCK+'/') : new URL('./mock/',import.meta.url);
  const configured=process.env.ALEMBIC_SKILLS_PREFIX??'skills/';
  const prefix=configured==='.'?'':configured;
  const nodes=(await readdir(new URL(prefix,root),{withFileTypes:true}))
    .filter(e=>e.isDirectory()&&/\.(i3d|i2d|audio)$/.test(e.name));
  assert.ok(nodes.length,'No authored skill results found');
  if(prefix)await page.getByRole('button',{name:prefix.replace(/\/$/,''),exact:true}).click();
  for(const node of nodes)await step(node.name,()=>checkNode(context,root,prefix+node.name));
}

async function checkNode({page,shot},root,path){
  const type=path.split('.').at(-1),document=readExports(await readFile(new URL(path+'/exports.txt',root)),path);
  const rows=readPlaybacks(await readFile(new URL(path+'/playbacks.txt',root)),document);
  assert.ok(rows.length,'Node declares its own playback');
  const starting=document.nodes.find(n=>n.id===document.defaultView).path;
  const ready=async(previous='')=>{
    await page.waitForFunction(()=>window.__alembic?.state().file);
    if(/\.(glb|gltf)$/.test(await page.evaluate(()=>__alembic.state().file))){
      await page.waitForFunction(()=>__alembic.pose()&&document.querySelector('.scene canvas')?.style.visibility!=='hidden');return page;
    }
    return renderFrame(page,previous);
  };
  const tools=()=>page.locator('[aria-label="Selection tools"] button').evaluateAll(a=>a.map(e=>e.getAttribute('aria-label')));
  const quiet=async()=>{
    const errors=await page.locator('.status,[role=status]').allInnerTexts();
    assert.ok(!errors.some(s=>/visible DOM text|must not create a 3D|unavailable|failed|error/i.test(s)),errors.join('\n'));
  };
  const previous=await page.locator('.viewport iframe').evaluateAll(frames=>frames[0]?.getAttribute('src')||'');
  await page.getByRole('button',{name:path.split('/').at(-1),exact:true}).click();
  await page.waitForFunction(file=>window.__alembic?.state().file===file,starting);
  let frame=await ready(previous);await page.waitForTimeout(300);
  assert.deepEqual(await tools(),type==='i3d'?['area','sphere','box','pick']:['area']);
  validateRenderEffect(path,await frame.evaluate(observeEffect));await quiet();
  const contexts=await frame.evaluate(()=>[...new Set(window.__skillContexts||[])]);
  let gpu;
  if(type==='i3d'){
    const expected=process.env.ALEMBIC_GPU_PATH==='webgl2'?'webgl2':'webgpu';
    assert.ok(contexts.includes(expected),`Expected actual ${expected} canvas, saw ${contexts}`);
    gpu=await frame.evaluate(async()=>{
      const canvas=document.querySelector('canvas');
      if(window.__skillContexts.includes('webgl2')){
        const gl=canvas.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
        return {description:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),fallback:false};
      }
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
      return {description:[adapter?.info.vendor,adapter?.info.description].filter(Boolean).join(' '),fallback:adapter?.isFallbackAdapter||adapter?.info.isFallbackAdapter||false};
    });
    assert.ok(gpu.description);assert.equal(gpu.fallback,false);
    assert.doesNotMatch(gpu.description,/swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i);
  }
  const pixels=()=>page.locator('.viewport').screenshot();
  const before=await pixels();
  const colors=await page.evaluate(async png=>{
    const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
    const canvas=new OffscreenCanvas(96,96),c=canvas.getContext('2d');c.drawImage(image,0,0,96,96);
    const d=c.getImageData(0,0,96,96).data,s=new Set();for(let i=0;i<d.length;i+=4)s.add(d.slice(i,i+3).join(','));return s.size;
  },before.toString('base64'));
  assert.ok(colors>3,'Nonblank authored result');
  const menu=page.locator('details.playback-menu'),summary=page.locator('summary[aria-label="Playback"]');
  const show=async()=>{if(!await menu.evaluate(e=>e.open))await summary.click()};
  await show();
  await page.waitForFunction(count=>document.querySelectorAll('[role=menuitem]').length===count,rows.length);
  await summary.click();
  const signal=()=>window.__skillAudio.some(a=>{
    if(a.context.state!=='running')return false;
    const data=new Float32Array(1024);a.getFloatTimeDomainData(data);return data.some(n=>Math.abs(n)>0.00001);
  });
  const scenarios=[];
  for(const row of rows){
    await show();const item=page.getByRole('menuitem').filter({hasText:row.label+' ·'});
    assert.ok((await item.innerText()).includes(row.duration===null?'duration unknown':row.duration+'s'));
    await item.click();frame=await ready();
    const play=page.getByRole('button',{name:'Play replay',exact:true});
    await play.waitFor();await page.waitForFunction(()=>!document.querySelector('[aria-label="Play replay"]').disabled);
    assert.equal(await page.locator('[aria-label="Replay position"]').inputValue(),'0');
    if(type==='audio')assert.equal(await frame.evaluate(signal),false,'Armed playback is silent');
    await play.click();await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Replay position"]').value)>0);
    if(row.duration!==null)assert.equal(Number(await page.locator('[aria-label="Replay position"]').getAttribute('max')),row.duration);
    if(type==='audio'){
      await frame.evaluate(()=>{
        const audio=document.querySelector('audio');if(audio){const c=new AudioContext();c.createMediaElementSource(audio).connect(c.destination);return c.resume();}
      });
      await frame.waitForFunction(signal);
    }
    await page.waitForTimeout(350);
    const changed=!before.equals(await pixels());
    // glTF {} is a legitimate static audition; motion scripts must do something.
    if(type!=='audio'&&!(document.nodes.find(n=>n.id===row.render)?.format.match(/^(glb|gltf)$/)&&row.script?.trim()==='{}'))
      assert.ok(changed,'Playback visibly exercises the authored effect');
    await shot(path.split('/').at(-1));
    await quiet();validateRenderEffect(path,await frame.evaluate(observeEffect));
    if(row.duration!==null){
      await page.waitForFunction(()=>!document.querySelector('[aria-label="Play replay"]').disabled&&document.querySelector('[aria-label="Replay position"]').value==='0',null,{timeout:row.duration*1000+5000});
      frame=await ready();if(type==='audio')assert.equal(await frame.evaluate(signal),false,'Completion is silent');
      await play.click();await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Replay position"]').value)>0);
    }
    await show();await page.getByRole('button',{name:'Reset to inspect',exact:true}).click();
    await page.waitForFunction(file=>__alembic.state().file===file&&document.querySelector('[aria-label="Play replay"]').disabled,starting);
    frame=await ready();await page.waitForTimeout(150);await quiet();
    if(await menu.evaluate(e=>e.open))await summary.click();
    let resetDrift=0;
    if(type==='audio')assert.equal(await frame.evaluate(signal),false,'Reset is silent');
    else if(type==='i3d'){
      // Match frozen checks: hardware antialiasing can differ by a few channels.
      resetDrift=await page.evaluate(async pngs=>{
        const images=await Promise.all(pngs.map(async png=>{const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();return image}));
        if(images[0].width!==images[1].width||images[0].height!==images[1].height)return 1;
        const canvas=new OffscreenCanvas(images[0].width,images[0].height),c=canvas.getContext('2d');
        const data=images.map(image=>{c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(image,0,0);return c.getImageData(0,0,canvas.width,canvas.height).data});
        return data[0].reduce((n,value,i)=>n+(Math.abs(value-data[1][i])>12),0)/data[0].length;
      },[before.toString('base64'),(await pixels()).toString('base64')]);
      assert.ok(resetDrift<=.02,`Reset pixel drift ${resetDrift} exceeds 2% at channel tolerance 12`);
    }else assert.ok((await pixels()).equals(before),'Reset restores authored pixels');
    scenarios.push({id:row.id,seconds:row.duration,changed,completed:row.duration!==null,replayed:row.duration!==null,reset:true,resetDrift});
  }
  return {type,tools:await tools(),contexts,gpu,colors,scenarios};
}
