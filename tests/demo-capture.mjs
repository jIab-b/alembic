// Data-driven real UI actions and CDP page capture. Used as ALEMBIC_CHECK by ui-check-windows.
// Plan: {name,capture,actions:[{op,selector,text,ms,from,to,...}]}; no renderer mutations.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tool} from '../backend/deps.mjs';
import assert from 'node:assert/strict';
export async function check({page,result,shot,file}) {
  const plan=JSON.parse(await readFile(process.env.ALEMBIC_DEMO_PLAN,'utf8'));
  const out=process.env.ALEMBIC_OUT, frames=resolve(out,'frames');
  await page.setViewportSize({width:1600,height:900});
  const cdp=await page.context().newCDPSession(page), entries=[], writes=[],milestones=[];let index=0,last=0,speed=1;
  if(plan.capture){
    await mkdir(frames,{recursive:true});
    cdp.on('Page.screencastFrame',async event=>{
      await cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId});
      const now=event.metadata.timestamp;
      if(now-last<(speed/(plan.fps||30)))return;
      last=now;const name=String(index++).padStart(6,'0')+'.jpg';
      const entry={name,time:now,speed};entries.push(entry);
      writes.push(writeFile(resolve(frames,name),Buffer.from(event.data,'base64')));
    });
    await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1600,maxHeight:900,everyNthFrame:1});
  }
  const sensitive=[];
  const privacy=setInterval(async()=>{
    const text=await page.locator('.xterm-rows').innerText().catch(()=> '');
    if(/(?:[?&#]token=|#node=|\bsk-[A-Za-z0-9_-]{20,}|(?:API_KEY|FAL_KEY|ACCESS_TOKEN)=\S+)/i.test(text))
      sensitive.push(Date.now()/1000);
  },300);
  try {
    for(const action of plan.actions){
      speed=action.speed||1;
      const target=action.selector?page.locator(action.selector):null;
      if(action.op==='click')await target.click({button:action.button||'left',timeout:action.timeout||15000});
      else if(action.op==='type')await page.keyboard.type(action.text,{delay:action.delay??35});
      else if(action.op==='press')await page.keyboard.press(action.key);
      else if(action.op==='wait')await page.waitForTimeout(action.ms);
      else if(action.op==='visible')await target.waitFor({state:action.state||'visible',timeout:action.timeout||30000});
      else if(action.op==='text')await page.waitForFunction(({selector,text})=>
        document.querySelector(selector)?.textContent.includes(text),action,{timeout:action.timeout||30000});
      else if(action.op==='shot'){await shot(action.name);milestones.push({name:action.name,time:Date.now()/1000});}
      else if(action.op==='count'){const count=await target.count();assert.equal(count,action.value);
        (result.assertions||=[]).push({selector:action.selector,count});}
      else if(action.op==='jobs'){
        const deadline=Date.now()+(action.timeout||15000);let pending;
        do{
          const data=JSON.parse((await file('.alembic/selection.json')).toString());
          pending=data.pending?.length||0;
          if(pending===action.pending)break;
          await page.waitForTimeout(250);
        }while(Date.now()<deadline);
        assert.equal(pending,action.pending,'Persisted real prompt jobs');
        (result.assertions||=[]).push({pendingJobs:pending});
      }
      else if(action.op==='drag'){
        const b=await page.locator(action.selector||'.viewport').boundingBox();
        const point=p=>[b.x+b.width*p[0],b.y+b.height*p[1]],a=point(action.from),z=point(action.to);
        if(action.key)await page.keyboard.down(action.key);
        await page.mouse.move(...a);await page.mouse.down();
        const n=action.steps||60;
        for(let i=1;i<=n;i++){await page.mouse.move(a[0]+(z[0]-a[0])*i/n,a[1]+(z[1]-a[1])*i/n);
          await page.waitForTimeout(action.delay||20)}
        await page.mouse.up();if(action.key)await page.keyboard.up(action.key);
      }else if(action.op==='gpu'){
        result.gpu=await page.evaluate(async()=>{
          const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
          const gl=document.createElement('canvas').getContext('webgl2'),e=
            gl?.getExtension('WEBGL_debug_renderer_info');
          return {webgpu:adapter?{vendor:adapter.info.vendor,description:adapter.info.description,fallback:
            adapter.isFallbackAdapter||adapter.info.isFallbackAdapter||false}:null,webgl2:e&&
              gl.getParameter(e.UNMASKED_RENDERER_WEBGL)};
        });
        assert.ok(result.gpu.webgpu&&!result.gpu.webgpu.fallback);
        assert.doesNotMatch(JSON.stringify(result.gpu),/swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i);
      }else throw Error('Unknown demo action '+action.op);
    }
  } finally {
    clearInterval(privacy);
    if(plan.capture)await cdp.send('Page.stopScreencast');
    await Promise.all(writes);
    await writeFile(resolve(out,'capture.json'),JSON.stringify({name:plan.name,ended:Date.now()/1000,frames:entries,
      sensitive,milestones},null,2));
    result.demo={name:plan.name,frames:entries.length,sensitive:sensitive.length};
    result.visible=await page.locator('.xterm-rows').innerText().catch(()=> '');
    result.status=await page.locator('.status,[role=status]').allInnerTexts();
    await shot('last');await cdp.detach();
  }
}

// Edit file: {output,segments:[{directory,from?,to?}]}; omitted bounds retain the whole capture.
// Frame timings are real; only explicitly speed-marked waits are time-lapsed.
if(process.argv[2]==='--encode'){
  const edit=JSON.parse(await readFile(process.argv[3],'utf8')),lines=['ffconcat version 1.0'];
  let seconds=0,lastPath;
  for(const segment of edit.segments){
    const capture=JSON.parse(await readFile(join(segment.directory,'capture.json'),'utf8'));
    const start=capture.frames[0]?.time;
    for(let i=0;i<capture.frames.length;i++){
      const frame=capture.frames[i],offset=frame.time-start;
      if(offset<(segment.from||0)||offset>=(segment.to??Infinity))continue;
      lastPath=resolve(segment.directory,'frames',frame.name);
      const next=Math.min(capture.frames[i+1]?.time||capture.ended,start+(segment.to??Infinity));
      const duration=Math.max(1/30,(next-frame.time)/(frame.speed||1));seconds+=duration;
      lines.push("file '"+lastPath.replaceAll("'","'\\''")+"'",'duration '+duration.toFixed(6));
    }
  }
  assert.ok(lastPath,'No actual browser frames');lines.push("file '"+lastPath.replaceAll("'","'\\''")+"'");
  const list=resolve(process.env.TMPDIR,'demo.ffconcat');await writeFile(list,lines.join('\n')+'\n');
  const ffmpeg=process.env.FFMPEG||tool('ffmpeg-nvenc/bin/ffmpeg','ffmpeg');
  const run=spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',list,
    '-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','fast','-crf','23','-movflags','+faststart',edit.output],
      {stdio:'inherit'});
  assert.equal(run.status,0,'H.264 encoding failed');console.log(JSON.stringify({seconds,output:edit.output}));
}
