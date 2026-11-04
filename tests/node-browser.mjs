import test from 'node:test';
import assert from 'node:assert/strict';
import {access, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {serveReal,realPrerequisite} from './real-node.mjs';
const require=createRequire(import.meta.url);
const until=async(predicate,label)=>{for(let i=0;i<200;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}assert.fail('Timed out: '+label);};
async function acceptance(t,node,chromium){
  let browser;
  try {
    try{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});}
    catch(e){if(/ENOENT|executable doesn't exist|error while loading shared libraries|Operation not permitted|Permission denied|sandbox.*(failed|not supported)|Failed to move to new namespace/i.test(e.message)){t.skip('Browser unavailable: '+e.message.slice(0,300));return;}throw e;}
    const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',request=>{const u=new URL(request.url());if(u.origin===node.origin)node.calls.push({path:u.pathname,query:Object.fromEntries(u.searchParams),method:request.method(),body:request.postDataBuffer()});});
      page.on('websocket',socket=>socket.on('framesent',frame=>{const text=Buffer.isBuffer(frame.payload)?frame.payload.toString():frame.payload;if(!text.startsWith('\0'))node.typed.push(text);}));
    const file=async path=>{
      const result=await node.api('file',path);return result.base64?Buffer.from(result.base64,'base64'):result;
    };
    await page.goto(node.frontend+'/#'+new URLSearchParams({node:node.origin,token:node.token,workspace:node.workspace,vm:node.vm,agents:node.agents.join(',')}));
    await page.getByRole('button',{name:'note.txt',exact:true}).waitFor();
    await page.evaluate(()=>window.__alembic.ready());
    await t.test('old panels, tabs, theme and fragment connection',async()=>{
      assert.equal(await page.title(),'project');
      assert.equal(new URL(page.url()).hash,'');
      assert.equal(await page.evaluate(token=>JSON.stringify(localStorage).includes(token),node.token),false);
      assert.equal(await page.evaluate(token=>sessionStorage.getItem('alembic-connection').includes(token),node.token),true);
      await page.reload();
      await page.getByRole('button',{name:'note.txt',exact:true}).waitFor();
      await page.evaluate(()=>window.__alembic.ready());
      assert.equal(await page.title(),'project');
      assert.equal(await page.getByRole('combobox',{name:'Agent provider',exact:true}).count(),0);
      await page.getByRole('button',{name:'Collapse agent',exact:true}).waitFor();
      await page.getByRole('button',{name:'note.txt',exact:true}).click();await until(async()=>await page.locator('.viewport pre').textContent()==='AFTER','live text');
      await page.getByRole('button',{name:'scene.svg',exact:true}).click();await page.locator('.viewport iframe').waitFor();
      await page.getByRole('tab',{name:'note.txt',exact:true}).click();assert.equal(await page.locator('.viewport pre').textContent(),'AFTER');
      await page.getByRole('button',{name:'New file tab',exact:true}).click();assert.equal(await page.getByRole('tab').count(),3);
      await page.getByRole('button',{name:'Collapse folder',exact:true}).click();await page.getByRole('button',{name:'Open folder',exact:true}).click();
      await page.getByRole('button',{name:'Toggle theme',exact:true}).click();
      assert.equal(await page.getByRole('combobox',{name:'Version',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Expand graph',exact:true}).count(),0);
    });
    await t.test('agent terminal sends ordinary commands into the sandbox',async()=>{
      await page.locator('.native-agent-terminal .xterm-helper-textarea').focus();
      await until(()=>node.calls.some(c=>c.path.endsWith('/shell/ticket')),'sandbox ticket');
      await page.keyboard.type("printf 'sandbox-echo\\n'\r");
      await until(()=>node.typed.join('').includes('sandbox-echo'),'sandbox input');
    });
    async function selection(path,prompt,shape='area'){
      await page.getByRole('button',{name:path,exact:true}).click();
      await page.evaluate(path=>window.__alembic.open(path),path);
      if(shape==='area')await page.frameLocator('.viewport iframe').locator('svg').waitFor();else await page.locator('.scene canvas').waitFor();
      await page.getByRole('button',{name:shape,exact:true}).click();const box=await page.locator('.viewport').boundingBox();
      if(shape==='area'){
        await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7,{steps:6});await page.mouse.up();
      }else await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5);
      // Saved highlights live on the canvas, not in a growing toolbar list.
      assert.equal(await page.locator('.highlight-list').count(),0);
      if(shape==='area')await page.locator('.area.active .edge.top').last().click({button:'right'});
      else {
        await page.keyboard.press('Escape');
        const point=await page.evaluate(()=>{const s=window.__alembic.selection().selections.at(-1);return window.__alembic.project(s.center);});
        await page.mouse.click(box.x+point[0],box.y+point[1],{button:'right'});
      }
      await page.getByRole('menuitem',{name:'Prompt',exact:true}).click();await page.locator('.node textarea').fill(prompt);
      await page.locator('.node').getByRole('button',{name:'Send',exact:true}).click();
      await until(()=>node.typed.some(s=>s.startsWith('Look at ')&&s.includes(prompt)),'selection reference');
      const write=node.calls.filter(c=>c.method==='PUT'&&c.query.path?.startsWith('.alembic/selections/')).at(-1);assert.ok(write);
      const doc=JSON.parse(await file(write.query.path));assert.equal(doc.file,path);assert.equal(doc.prompt,prompt);assert.equal(doc.selection.shape,shape);
      const crop=await file(doc.selection.crop);assert.equal(crop.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    }
    await t.test('SVG selection, crop and prompt',()=>selection('scene.svg','Make this blue'));
    await t.test('textured 3D viewer and volume crop',()=>selection('model.glb','Change this object','sphere'));
    await mkdir('tests/out',{recursive:true});await page.screenshot({path:'tests/out/restored-real.png'});
    assert.ok(!node.calls.some(c=>c.path.startsWith('/fs/')));assert.deepEqual(errors,[]);
  }finally{await browser?.close();}
}
test('restored UI against the real vault', {timeout:180000},async t=>{
  const reason=await realPrerequisite();if(reason){t.skip(reason);return;}
  let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch(e){if(e.code==='MODULE_NOT_FOUND'){t.skip('Playwright is unavailable');return;}throw e;}
  try{await access('frontend/dist/index.html');}catch(e){if(e.code==='ENOENT'){t.skip('Build frontend first');return;}throw e;}
  const node=await serveReal();
  try{await acceptance(t,node,chromium);}finally{await node.close();}
});
