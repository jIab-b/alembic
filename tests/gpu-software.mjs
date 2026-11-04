// An actual SwiftShader negative control; no fake adapter identities.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {playwright,chromiumPath} from '../backend/deps.mjs';
import {assertHardware} from '../tools/gpu-browser.mjs';
if(!process.env.TMPDIR)throw Error('TMPDIR is required');
if(resolve(process.env.TMPDIR).startsWith(process.cwd()+'/'))process.env.TMPDIR='/proc/self/cwd/'+resolve(process.env.TMPDIR).slice(process.cwd().length+1);
const {chromium}=playwright();
const server=createServer(async(req,res)=>{const path=req.url==='/bridge.js'?'render/godot/bridge.js':req.url==='/interaction.js'?'frontend/public/assets/play/interaction.js':null;res.setHeader('Content-Type',path?'text/javascript':'text/html');res.end(path?await readFile(resolve(path)):'<canvas></canvas>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
  browser=await chromium.launch({executablePath:chromiumPath(),headless:true,
    env:{...process.env,XDG_CACHE_HOME:join(process.env.TMPDIR,'cache')},
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  await assert.rejects(assertHardware(page),/Software WebGL renderer:.*SwiftShader/i);
  await assert.rejects(page.evaluate(async()=>{const {requireGPU}=await import('/bridge.js');requireGPU(document.querySelector('canvas'))}),/Godot requires hardware WebGL2:.*SwiftShader/i);
  console.log('Actual SwiftShader rejection: 2/2 passed');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
