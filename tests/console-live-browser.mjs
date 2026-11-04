// Explicit opt-in: connects to the already running vault_lite VM; never starts a VM.
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const python=`import json, launcher
identity, rows = launcher.existing_vault()
workspace='ccb417f1deee44db851997452002d25b'
vm=next(row['id'] for row in rows if row.get('workspace')==workspace)
print(json.dumps({'origin':'http://127.0.0.1:'+str(launcher.controller_port(identity)), 'workspace':workspace,'vm':vm,'token':(launcher.sandbox._store()/'token').read_text().strip()}))`;
const config=JSON.parse(execFileSync('python3',['-c',python],{encoding:'utf8'}));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}), observed=[], requests=[], sockets=[];
 page.on('response',r=>{const p=new URL(r.url()).pathname;if (/\/(launch|attach)$/.test(p)) requests.push([p.replace(/sessions\/[^/]+/,'sessions/[id]'),r.status()]);});
 page.setDefaultTimeout(45000);
 page.on('websocket',ws=>{sockets.push('created'); ws.on('framereceived',frame=>observed.push(String(frame.payload))); ws.on('framesent',()=>sockets.push('sent')); ws.on('close',()=>sockets.push('closed')); ws.on('socketerror',error=>sockets.push('error: '+error.replace(/(?:https?|wss?):\/\/\S+/g,'[URL]')));});
 await page.goto(config.origin+'/#'+new URLSearchParams({node:config.origin,token:config.token,workspace:config.workspace,vm:config.vm,agents:'codex'}));
 await page.evaluate(()=>window.__alembic.ready());
 const input=page.getByRole('textbox',{name:'Message the agent'}); await input.fill('Use no tools. Reply exactly OK.'); await input.press('Enter');
 const transcript=page.locator('.conversation');
 try { await transcript.locator('.status',{hasText:'Session started'}).waitFor({timeout:15000}); } catch (e) { const lines=await transcript.locator('li').allTextContents(); console.error('Transport:', JSON.stringify({requests,sockets,frames:observed.length,lengths:observed.map(x=>x.length)})); console.error('Console status:', lines.map(x=>x.replace(/(?:https?|wss?):\/\/\S+/g,'[URL]').replace(/(?:token|secret|ticket|authorization)\s*[:=]\s*\S+/gi,'[redacted]'))); throw e; }
 const pending=await transcript.locator('.pending').count();
 await transcript.locator('.agent',{hasText:'OK'}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.conversation .pending'),null,{timeout:45000});
 await mkdir('tests/out',{recursive:true});await page.screenshot({path:'tests/out/console-live-headless.png'});
 console.log(JSON.stringify({earlySessionWhileRunning:pending===1,receivedFrames:observed.length,actualAgentMessageVisible:true,screenshot:'tests/out/console-live-headless.png'}));
} finally {await browser.close();}
