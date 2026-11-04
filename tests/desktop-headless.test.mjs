import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile,stat} from 'node:fs/promises';

test('headless acceptance mode keeps the Electron window offscreen and disables notification paths',async()=>{
  const main=fileURLToPath(new URL('../desktop/main.cjs',import.meta.url));
  const userData=await mkdtemp(join(tmpdir(),`alembic-electron-headless-${process.pid}-`));
  const source=`
    const Module=require('node:module'), original=Module._load, calls={show:0,dialog:0,switches:[],paths:[],permissionResult:null,windowOptions:null};
    const app={commandLine:{appendSwitch:(...a)=>calls.switches.push(a)},on(){},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),setName(){},setPath:(...a)=>calls.paths.push(a),getPath:()=>${JSON.stringify(userData)},quit(){},exit(){}};
    class BrowserWindow{constructor(options){calls.windowOptions=options;this.webContents={session:{setPermissionRequestHandler(fn){calls.permissionHandlerInstalled=!!fn;fn({},'notifications',value=>calls.permissionResult=value,{requestingUrl:'http://127.0.0.1:54629'})},setPermissionCheckHandler(){}},setWindowOpenHandler(){},on(){},getURL:()=>'',executeJavaScript:async()=>({workspace:'fixture',vm:'fixture-vm',workspaceListed:true,vmVerified:true,rootTreeListed:true,error:''})};this.once=()=>{};this.loadURL=async()=>{};this.isDestroyed=()=>false;this.show=()=>calls.show++;this.isMinimized=()=>false;this.restore=()=>{};this.focus=()=>{}}}
    const electron={app,BrowserWindow,Menu:{setApplicationMenu(){},buildFromTemplate:x=>x},dialog:{showErrorBox(){calls.dialog++}}};
    Module._load=function(name,parent,isMain){if(name==='electron')return electron;return original.call(this,name,parent,isMain)};
    process.argv=[process.execPath,'--alembic-headless-acceptance','--connect','http://127.0.0.1:54629/?workspace=fixture#token=fixture-token&vm=fixture-vm'];
    const realSetTimeout=global.setTimeout;global.setTimeout=(fn,delay,...args)=>fn===app.quit?{unref(){}}:realSetTimeout(fn,delay,...args);
    console.log=(()=>{const write=process.stdout.write.bind(process.stdout);return (...args)=>write(String(args[0])+'\\n')})();
    require(${JSON.stringify(main)});
    setTimeout(()=>{process.stdout.write('ALEMBIC_TEST_STATE '+JSON.stringify(calls)+'\\n');process.exit(0)},100);
  `;
  const child=spawn(process.execPath,['-e',source],{stdio:['ignore','pipe','pipe'],env:{...process.env,APPDATA:userData,ALEMBIC_HEADLESS_TIMEOUT_MS:'15000'}});
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>stdout+=chunk);
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>stderr+=chunk);
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(`mock Electron source check timed out: ${stderr}`))},5000);child.on('error',reject);child.on('exit',value=>{clearTimeout(timer);resolve(value)})});
  assert.equal(code,0,stderr);
  const ready=/ALEMBIC_HEADLESS_READY (\{[^\n]+\})/.exec(stdout);
  const state=/ALEMBIC_TEST_STATE (\{[^\n]+\})/.exec(stdout);
  assert.ok(ready,stdout);assert.equal(JSON.parse(ready[1]).backend,'authenticated-go-api');assert.deepEqual(JSON.parse(ready[1]).checks,{workspaceListed:true,vmVerified:true,rootTreeListed:true});
  const calls=JSON.parse(state[1]);
  assert.equal(calls.show,0);assert.equal(calls.dialog,0);
  assert.equal(calls.windowOptions.show,false);assert.equal(calls.windowOptions.offscreen,true);assert.equal(calls.windowOptions.focusable,false);
  assert.deepEqual(calls.paths[0],['appData',userData]);
  assert.ok(calls.switches.some(([name])=>name==='disable-notifications'));
  assert.equal(calls.permissionHandlerInstalled,true);assert.equal(calls.permissionResult,false);
});

test('headless startup errors persist a diagnostic and exit without Electron dialog',async()=>{
  const main=fileURLToPath(new URL('../desktop/main.cjs',import.meta.url));
  const root=await mkdtemp(join(tmpdir(),`alembic-electron-error-${process.pid}-`));
  const userData=join(root,'nested','profile'),diagnostic=join(root,'logs','headless.log');
  const source=`
    const Module=require('node:module'),original=Module._load;
    const app={commandLine:{appendSwitch(){}},on(){},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),setName(){},setPath(){},getPath:()=>${JSON.stringify(userData)},quit(){},exit(){}};
    const electron={app,BrowserWindow:class{constructor(){throw new Error('must not open')}},Menu:{setApplicationMenu(){},buildFromTemplate:x=>x},dialog:{showErrorBox(){process.stderr.write('UNEXPECTED_DIALOG\\n')}}};
    Module._load=function(name,parent,isMain){if(name==='electron')return electron;return original.call(this,name,parent,isMain)};
    process.argv=[process.execPath,'--alembic-headless-acceptance','--connect','http://127.0.0.1:54629/#token=secret&vm=fixture&workspace=fixture','--wrong-option'];
    require(${JSON.stringify(main)});
  `;
  const child=spawn(process.execPath,['-e',source],{stdio:['ignore','pipe','pipe'],env:{...process.env,APPDATA:join(root,'appdata'),ALEMBIC_HEADLESS_TIMEOUT_MS:'1000',ALEMBIC_HEADLESS_LOG:diagnostic}});
  let stdout='',stderr='';child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(`headless failure diagnostic timed out: ${stderr}`))},5000);child.on('error',reject);child.on('exit',value=>{clearTimeout(timer);resolve(value)})});
  assert.equal(code,1,stderr);assert.equal(stdout,'');assert.doesNotMatch(stderr,/UNEXPECTED_DIALOG/);
  assert.match(stderr,/ALEMBIC_HEADLESS_ERROR \{"stage":"startup"/);assert.doesNotMatch(stderr,/token=secret/);
  const log=await readFile(diagnostic,'utf8');assert.match(log,/Unknown option: --wrong-option/);assert.doesNotMatch(log,/token=secret/);
  await stat(join(userData,'launch-error.log'));
});
