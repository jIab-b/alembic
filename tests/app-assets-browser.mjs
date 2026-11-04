import {windowsBrowser} from './windows-browser.mjs';
// Native Windows Chrome against the disposable compiled-style app in app-assets.py.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {context, dispose} = await windowsBrowser();
try {
 const page=context.pages()[0],failed=[];let bypasses=0;
 page.on('response',r=>{
  const path=new URL(r.url()).pathname;
  if(r.status()===404&&/\/play\/app\/[^/]+\/index\.html$/.test(path))bypasses++;
  if(r.status()>=400&&/\/(?:assets\/site|icons\/)/.test(path))failed.push(path);
 });
 const url=(await readFile(process.argv[2],'utf8')).trim();
 for(let attempt=0;;attempt++){try{await page.goto(url,{waitUntil:'domcontentloaded'});break}catch(e){if(attempt>=30)throw Error('Relay did not become reachable from Windows');await page.waitForTimeout(100)}}
 if(process.argv.includes('--recover-fail')){
  await page.getByRole('alert').filter({hasText:'preview session could not recover after reload'}).waitFor();
  assert.equal(bypasses,3,'Initial attempt plus two retries');
  console.log('PASS: persistent preview bypass stops after bounded retries and reports the entry path');
 }else{
 let app;
 for(let i=0;i<100;i++){
  app=page.frames().find(f=>f.url().includes('/app/')&&f.url().endsWith('/index.html'));
  if(app&&await app.locator('#status').count())break;
  await page.waitForTimeout(100);
 }
 assert.ok(app,'Embedded document loads');
 await app.waitForFunction(()=>document.querySelector('#status')?.textContent==='APP_BOOTED',{},{timeout:5000}).catch(()=>{throw Error('Compiled app did not boot; failed assets: '+failed.join(', '))});
 assert.equal(await app.locator('#status').evaluate(e=>getComputedStyle(e).color),'rgb(12, 34, 56)');
 assert.equal(await app.evaluate(()=>window.nestedAsset),'nested module');
 if(process.argv.includes('--recover'))assert.ok(bypasses>0,'The test exercised a real backend 404');
 await app.evaluate(()=>location.reload());
 await app.waitForFunction(()=>document.querySelector('#status')?.textContent==='APP_BOOTED');
 assert.deepEqual(failed,[]);
 console.log('PASS: compiled app boots, loads absolute CSS/JS and nested imports, and reloads');
 }
}finally{await dispose()}
