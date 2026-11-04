// Shared workload for private WSL Chromium and tests/ui-check-windows.mjs.
import assert from 'node:assert/strict';
export async function workload(page,route) {
  if(route==='godot') {
    const frame=page.frames().find(f=>f.url().endsWith('/web/game.html'));
    await frame.waitForFunction(()=>window.godotFixture&&window.alembicGodotReceive,null,{timeout:45000});
    await frame.evaluate(()=>alembicGodotReceive(JSON.stringify({type:'alembic.web.play',id:'load',script:'load'})));
    const start=await frame.evaluate(()=>godotFixture.frames);await page.waitForTimeout(10000);
    const data=await frame.evaluate(()=>({gpu:alembicGodotGPU,frames:godotFixture.frames}));
    assert.ok(data.frames>start+5,'Godot stopped rendering');return data;
  }
  return page.evaluate(async route=>{
    const B=await import('/core/index.js'),canvas=document.querySelector('canvas');
    const gpu=route!=='webgl2';let adapter;
    if(gpu){adapter=await navigator.gpu.requestAdapter(route==='compat'?{featureLevel:'compatibility'}:{powerPreference:'high-performance'});if(!adapter)throw Error('Hardware WebGPU adapter unavailable')}
    const engine=gpu?new B.WebGPUEngine(canvas,{featureLevel:route==='compat'?'compatibility':'core',antialias:false}):new B.Engine(canvas,false,{disableWebGL1Support:true,preserveDrawingBuffer:true});
    if(gpu)await engine.initAsync();
    const ext=!gpu&&engine._gl.getExtension('WEBGL_debug_renderer_info'),renderer=gpu?JSON.stringify({vendor:adapter.info.vendor,device:adapter.info.device,description:adapter.info.description}):ext&&engine._gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if(!renderer||adapter?.isFallbackAdapter||adapter?.info.isFallbackAdapter||/swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i.test(renderer))throw Error('Software or unknown renderer: '+renderer);
    const scene=new B.Scene(engine),camera=new B.FreeCamera('camera',new B.Vector3(0,0,-5),scene);camera.setTarget(B.Vector3.Zero());new B.HemisphericLight('light',new B.Vector3(0,1,0),scene);
    const sphere=B.MeshBuilder.CreateSphere('sphere',{diameter:.13,segments:24},scene);
    for(let i=0;i<6000;i++){const instance=sphere.createInstance('sphere'+i);instance.position.set((i%100-50)*.05,(Math.floor(i/100)-30)*.05,i%7*.03)}
    await scene.whenReadyAsync();let pipeline,group,buffer,read;
    if(gpu){const device=engine._device,n=262144;buffer=device.createBuffer({size:n*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});read=device.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const module=device.createShaderModule({code:'@group(0) @binding(0) var<storage,read_write> data:array<u32>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){var v=id.x+1u;for(var i=0u;i<1024u;i++){v=(v^(v>>13u))*1664525u+1013904223u;}data[id.x]=v;}'});pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]})}
    let frames=0,lost=false;canvas.addEventListener('webglcontextlost',()=>lost=true);const start=Date.now();
    while(Date.now()-start<10000){engine.beginFrame();scene.render();engine.endFrame();frames++;if(gpu){const e=engine._device.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,group);p.dispatchWorkgroups(4096);p.end();engine._device.queue.submit([e.finish()]);await engine._device.queue.onSubmittedWorkDone()}else engine._gl.finish();await new Promise(r=>setTimeout(r,0))}
    if(gpu){const d=engine._device,e=d.createCommandEncoder();e.copyBufferToBuffer(buffer,0,read,0,4);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const actual=new Uint32Array(read.getMappedRange())[0];let expected=1;for(let i=0;i<1024;i++)expected=(Math.imul(expected^(expected>>>13),1664525)+1013904223)>>>0;if(actual!==expected)throw Error('WebGPU compute readback mismatch');read.unmap()}
    if(lost||frames<2)throw Error('No stable hardware frames');
    const result={renderer,frames,route,compute:gpu?'verified':'n/a'};engine.dispose();return result;
  },route);
}
export async function check({page,result,step}) {
  await step('gpu',async()=>{
    const cdp=await page.context().browser().newBrowserCDPSession(),info=await cdp.send('SystemInfo.getInfo');await cdp.detach();
    const data=await workload(page,process.env.ALEMBIC_GPU_PATH||'webgpu');if(info)data.diagnostics=info.gpu.auxAttributes;
    if(info){data.diagnostics={glRenderer:info.gpu.auxAttributes?.glRenderer};if(data.route==='webgpu'){const tab=await page.context().newPage();try{await tab.goto('chrome://gpu');await tab.waitForTimeout(1000);const text=await tab.evaluate(()=>document.querySelector('info-view')?.shadowRoot?.textContent||document.body.innerText);data.diagnostics.webgpu=text.match(/.{0,120}D3D12.{0,120}/g);assert.ok(data.diagnostics.webgpu?.length,'Chrome did not report a D3D12 backend')}finally{await tab.close()}}}
    result.gpu=data;return data;
  });
}
