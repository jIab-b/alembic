#!/usr/bin/env node
// Each path owns the shared GPU lock for less than two minutes. All artifacts are disposable.
import {spawn,execFileSync} from 'node:child_process';
import {readFile,mkdir,cp,rm,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tool} from '../backend/deps.mjs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {launchGpuBrowser} from './gpu-browser.mjs';
import {workload} from '../tests/gpu-workload.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),temp=resolve(process.env.TMPDIR||'');
if(!process.env.TMPDIR||!temp.startsWith(root+'/.tmp/'))throw Error('TMPDIR must be under this worktree .tmp/');
const env={...process.env,XDG_CACHE_HOME:join(temp,'cache'),XDG_CONFIG_HOME:join(temp,'config'),
  XDG_DATA_HOME:join(temp,'data'),LD_LIBRARY_PATH:'/usr/lib/wsl/lib:'+(process.env.LD_LIBRARY_PATH||'')};
Object.assign(process.env,env);
const paths=['Babylon Windows WebGPU D3D12','Babylon WSL WebGL2','Babylon WSL WebGPU compatibility',
  'Godot Windows web','Godot WSL Forward+','Blender WSL CUDA','Blender WSL OpenGL D3D12','ffmpeg WSL NVENC'];
async function run(command,args,timeout=100000){return new Promise((resolve,reject)=>{const child=spawn(command,args,{
  env,cwd:root,stdio:['ignore','pipe','pipe'],detached:true});let output='';const timer=setTimeout(()=>
    process.kill(-child.pid,'SIGTERM'),timeout);child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>
      output+=x);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(output):
        reject(Error(output.trim()||`${command} exited ${code}`))})})}
const childPath=process.argv.indexOf('--path'),index=Number(process.argv[childPath+1]);
if(childPath<0){
  const work=join(temp,'gpu-check');await mkdir(work,{recursive:true});env.ALEMBIC_GPU_WORK=work;
    process.env.ALEMBIC_GPU_WORK=work;
  const rows=[];
  try{
    await cp(join(root,'tests/fixtures/engines'),join(work,'godot'),{recursive:true});
    await run('python3',[join(root,'render/godot/export.py'),join(work,'godot'),join(work,'web/game.html')]);
    await run(tool('blender-cuda/blender','blender'),['--background','--factory-startup','--python-exit-code','1',
      '--python',join(root,'tests/blender-fixture.py'),'--',join(work,'model.blend')]);
    for(let i=0;i<paths.length;i++){
      while(Number((await readFile('/proc/meminfo',
        'utf8')).match(/MemAvailable:\s+(\d+)/)[1])<8*1024*1024)await new Promise(r=>setTimeout(r,1000));
      try{const out=await run('flock',['-w','120',join(root,'.tmp/gpu.lock'),'timeout','110','node',
        fileURLToPath(import.meta.url),'--path',String(i)],235000);
          rows.push(JSON.parse(out.trim().split('\n').at(-1)))}catch(error){rows.push({path:paths[i],ok:false,error:
            error.message})}
    }
  }catch(error){for(const path of paths)rows.push({path,ok:false,error:error.message})}
  finally{await writeFile(join(temp,'gpu-results.json'),JSON.stringify(rows,null,2));await rm(work,{recursive:true,
    force:true})}
  console.table(rows.map(r=>({Path:r.path,Result:r.ok?'PASS':'FAIL',GPU:r.load||'',Renderer:r.renderer||'',Error:
    r.error?.replace(/\s+/g,' ').slice(0,600)||''})));
  if(rows.some(r=>!r.ok))process.exitCode=1;
}else{
  const work=process.env.ALEMBIC_GPU_WORK;if(!work)throw Error('Internal path requires ALEMBIC_GPU_WORK');
  const row={path:paths[index],ok:false},samples=[];let sampling=true;
  const sample=async phase=>{try{let values;for(const smi of ['/usr/lib/wsl/lib/nvidia-smi',
    '/mnt/c/Windows/System32/nvidia-smi.exe']){const out=execFileSync(smi,
      ['--query-gpu=utilization.gpu,utilization.encoder','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:
        4000});values=out.trim().split('\n').map(s=>s.split(',').map(x=>Number(x.trim())));if(values.every(v=>
          v.every(Number.isFinite)))break}samples.push({at:Date.now(),phase,values})}catch{}};
  for(let n=0;n<4;n++){await sample('idle');await new Promise(r=>setTimeout(r,500))}
  const sampler=(async()=>{while(sampling){await sample('work');await new Promise(r=>setTimeout(r,500))}})();
  let server,browser;
  try{
    if(index<4){
      server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){
        res.setHeader('Content-Type','text/html');return res.end(index===3?
          '<iframe style="width:1280px;height:720px" src="/web/game.html"></iframe>':
            '<canvas width="1280" height="720"></canvas>')}const base=path.startsWith('/core/')?join(root,
              'frontend/node_modules/@babylonjs/core'):work;const file=resolve(base,path.startsWith('/core/')?
                path.slice(6):'.'+path);if(!file.startsWith(base+'/'))throw Error('Path outside fixture');
                  res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.html')?
                    'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream');
                      res.end(await readFile(file))}catch{res.statusCode=404;res.end()}});
      await new Promise(r=>server.listen(0,'0.0.0.0',r));const url='http://localhost:'+server.address().port;
      const route=index===1?'webgl2':index===2?'compat':index===3?'godot':'webgpu';
      if(index===0||index===3){
        const win=p=>execFileSync('wslpath',['-w',p],{encoding:'utf8'}).trim(),out=join(work,'windows-'+index);
          await mkdir(out,{recursive:true});
        const script=join(work,'windows.ps1');await writeFile(script,
          `$env:ALEMBIC_URL='${url}/#node=${url}&token=fixture&workspace=gpu'; `+
          `$env:ALEMBIC_OUT='${win(out)}'; `+
          `$env:ALEMBIC_PROFILE=Join-Path $env:TEMP 'alembic-ui-gpu-${process.pid}'; `+
          `$env:ALEMBIC_CHECK='${win(join(root,'tests/gpu-workload.mjs'))}'; `+
          `$env:ALEMBIC_GPU_PATH='${route}'; `+
          `for($i=0;$i -lt 20;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri '${url}/' `+
          `-TimeoutSec 1 | Out-Null; break}catch{Start-Sleep -Milliseconds 300}}; `+
          `& node.exe '${win(join(root,'tests/ui-check-windows.mjs'))}'; exit $LASTEXITCODE`);
        await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',win(script)]);
          const result=JSON.parse(await readFile(join(out,'result.json'),'utf8'));
            if(!result.gpu)throw Error(JSON.stringify(result));row.renderer=JSON.stringify(result.gpu.gpu||
              result.gpu.renderer);
      }else{browser=await launchGpuBrowser({webgpu:index===2});const page=await browser.newPage();
        await page.goto(url);row.renderer=JSON.stringify(await workload(page,route))}
    }else{
      const commands={
        4:['python3',[join(root,'tests/gpu-native.py'),tool('godot/godot','godot'),'--path',join(work,'godot'),
          '--rendering-method','forward_plus','--audio-driver','Dummy','--disable-vsync']],
        5:['python3',[join(root,'render/blender/bake.py'),join(work,'model.blend'),'--size','1024','--samples','256',
          '--seconds','8']],
        6:['python3',[join(root,'tests/gpu-native.py'),tool('blender-cuda/blender','blender'),'--factory-startup',
          '--python-exit-code','1','--python',join(root,'tests/blender-fixture.py'),'--',join(work,'opengl.blend'),
          '--opengl']],
        7:[tool('ffmpeg-nvenc/bin/ffmpeg','ffmpeg'),['-hide_banner','-loglevel','info','-f','lavfi','-i',
          'testsrc2=size=1920x1080:rate=120','-t','10','-c:v','h264_nvenc','-preset','p7','-f','null','-']]};
      const [command,args]=commands[index];row.renderer=(await run(command,args)).trim().split('\n').filter(s=>
        /GPU_|renderer|backend|devices|Video:.*h264|D3D12|CUDA|OptiX/i.test(s)).slice(-3).join(' ');
    }
    row.ok=true;
  }catch(error){row.error=error.message}
  finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}
    sampling=false;await sampler}
  const metric=index===7?1:0,values=phase=>samples.filter(s=>s.phase===phase).flatMap(s=>s.values?.map(v=>v[metric])||
    []).filter(Number.isFinite),idle=values('idle'),active=values('work');
  const baseline=Math.max(...idle),peak=Math.max(...active),raised=active.filter(v=>v>=baseline+8).length;
  row.load=`idle ${baseline}%, peak ${peak}%, raised ${raised}/${active.length}`;
  if(!idle.length||raised<2){row.ok=false;row.error=[row.error,
    'External GPU load did not correlate with work'].filter(Boolean).join('; ')}
  await writeFile(join(work,'samples-'+index+'.json'),JSON.stringify({row,samples}));console.log(JSON.stringify(row));
}
