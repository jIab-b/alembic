// The same data-driven frontend checks on headless WSL hardware WebGL2.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchGpuBrowser,assertHardware} from './gpu-browser.mjs';
import {check} from './windows-checks.mjs';
const out=resolve(process.env.ALEMBIC_OUT),result={checks:{},errors:[]};
await mkdir(out,{recursive:true});
let browser;
try {
  browser=await launchGpuBrowser({webgpu:true});
  const context=await browser.newContext({viewport:{width:1600,height:900}});
  await context.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined}));
  const page=await context.newPage();
  page.on('pageerror',e=>result.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))result.errors.push(m.text())});
  const shot=name=>page.screenshot({path:resolve(out,name+'.png')});
  const step=async(name,fn)=>{try{result.checks[name]=await fn()??true}catch(e){result.checks[name]={failed:e.message};await shot('failed-'+name);process.exitCode=1}};
  await page.goto((await readFile(process.env.ALEMBIC_URL_FILE,'utf8')).trim());
  result.gpu=await assertHardware(page);
  await check({page,result,step,shot});
} catch(e){result.errors.push(e.message);process.exitCode=1}
finally{
  await browser?.close();
  if(result.errors.length)process.exitCode=1;
  await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
