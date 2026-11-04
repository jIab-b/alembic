const headlessAcceptance=process.argv.includes('--alembic-headless-acceptance')||process.env.ALEMBIC_HEADLESS_ACCEPTANCE==='1';
function scrubHeadless(value){return String(value??'').replace(/((?:token|grant)=)[^&\s]*/ig,'$1<redacted>').replace(/Bearer\s+[^\s]+/ig,'Bearer <redacted>');}
function headlessFault(stage,error){
  const message=scrubHeadless(error?.stack||error?.message||error);
  const record='ALEMBIC_HEADLESS_ERROR '+JSON.stringify({stage,message});
  try{process.stderr.write(record+'\n')}catch{}
  try{if(process.env.ALEMBIC_HEADLESS_LOG){const fs=require('node:fs');fs.mkdirSync(require('node:path').dirname(process.env.ALEMBIC_HEADLESS_LOG),{recursive:true});fs.appendFileSync(process.env.ALEMBIC_HEADLESS_LOG,record+'\n',{mode:0o600});}}catch{}
  process.exitCode=1;setImmediate(()=>process.exit(1));
}
if(headlessAcceptance){process.on('uncaughtException',error=>headlessFault('uncaught-exception',error));process.on('unhandledRejection',error=>headlessFault('unhandled-rejection',error));}
const {app,BrowserWindow,Menu,dialog} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {launchOptions,tunnel,viewerPermission} = require('./connection.cjs');
if(process.platform==='linux'&&/microsoft/i.test(require('node:os').release())&&!headlessAcceptance){console.error('On WSL, use desktop/run_windows.py to open the native Windows GUI.');app.exit(1);}
if(headlessAcceptance){
  const appData=process.env.APPDATA;
  if(!appData||!path.isAbsolute(appData))throw new Error('Headless acceptance requires an absolute disposable APPDATA directory');
  fs.mkdirSync(appData,{recursive:true});
  app.setPath('appData',appData);
}
if(headlessAcceptance){
  app.commandLine.appendSwitch('disable-notifications');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-features','Notifications,PushMessaging');
}
app.setName('Alembic');
// Each launch gets its own backend session and isolated browser credentials.
if(process.env.ALEMBIC_SESSION) app.setPath('userData', path.join(app.getPath('appData'), 'Alembic', 'sessions', (process.env.ALEMBIC_BACKEND || 'unknown') + '-' + process.env.ALEMBIC_SESSION));
const debugAt=process.argv.indexOf('--alembic-debug-port'), debugPort=debugAt>=0?process.argv[debugAt+1]:process.env.ALEMBIC_DESKTOP_DEBUG_PORT;
if (/^\d{1,5}$/.test(debugPort || '')) app.commandLine.appendSwitch('remote-debugging-port',debugPort);
let window, closeTunnel=()=>{}, settings, profile;
function save() {const temp=profile+'.tmp';fs.mkdirSync(path.dirname(profile),{recursive:true});fs.writeFileSync(temp,JSON.stringify(settings),{mode:0o600});fs.renameSync(temp,profile);}
function remember(raw) {
  const url=new URL(raw);if(url.origin!==new URL(window.webContents.getURL()).origin)return;
  // Tokens stay in the renderer's saved project profile, never in this launch-settings file.
  const fragment=new URLSearchParams(url.hash.slice(1));if(fragment.has('token')||fragment.has('grant'))return;
  settings.workspace=url.searchParams.get('workspace')||settings.workspace;
  settings.minimal=url.searchParams.get('layout')==='minimal';save();
}
function mode(minimal) {
  const url=new URL(window.webContents.getURL());if(minimal)url.searchParams.set('layout','minimal');else url.searchParams.delete('layout');
  settings.minimal=minimal;save();window.loadURL(url.href);
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{closeTunnel(); if(primary && process.env.ALEMBIC_STOP_FILE) try { fs.writeFileSync(process.env.ALEMBIC_STOP_FILE, ''); } catch {} });
const primary=app.requestSingleInstanceLock();
app.on('second-instance',(_event,argv)=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.focus();if(argv.includes('--minimal'))mode(true);else if(argv.includes('--full'))mode(false);}});
if(primary)app.whenReady().then(async()=>{
  fs.mkdirSync(app.getPath('userData'),{recursive:true});
  profile=path.join(app.getPath('userData'),'connection.json');let saved={};
  try{saved=JSON.parse(fs.readFileSync(profile,'utf8'));}catch{}
  const input=process.defaultApp?process.argv.slice(2):process.argv.slice(1);
  const acceptanceIndex=input.indexOf('--alembic-headless-acceptance');if(acceptanceIndex>=0)input.splice(acceptanceIndex,1);
  const debug=input.indexOf('--alembic-debug-port');if(debug>=0)input.splice(debug,2);
  if(process.env.ALEMBIC_LAUNCH_URL) { input.unshift('--connect',process.env.ALEMBIC_LAUNCH_URL); delete process.env.ALEMBIC_LAUNCH_URL; }
  const connection=launchOptions(input,saved);settings={...connection.options};
  const launch=new URL(connection.url),fragment=new URLSearchParams(launch.hash.slice(1));
  if(headlessAcceptance){settings.minimal=false;launch.searchParams.delete('layout');}
  settings.preview=new URLSearchParams(new URL(settings.url).hash.slice(1)).get('preview')||settings.preview;
  // Keep the remote endpoint in settings, so reconnecting recreates the same forwards.
  const endpoint=new URL(settings.url);const params=new URLSearchParams(endpoint.hash.slice(1));
  settings.workspace=params.get('workspace')||endpoint.searchParams.get('workspace')||settings.workspace;endpoint.hash='';settings.url=endpoint.href;
  if(!fragment.has('token')&&!fragment.has('grant')&&settings.workspace)launch.searchParams.set('workspace',settings.workspace);
  let loading=true;
  if(settings.ssh)closeTunnel=await tunnel(settings.ssh,connection.forwards,e=>{if(!loading&&window&&!window.isDestroyed()){if(headlessAcceptance){console.error('ALEMBIC_HEADLESS_ERROR '+JSON.stringify({stage:'tunnel',message:String(e.message||e)}));app.quit();}else dialog.showErrorBox('SSH connection ended',e.message);}});
  const origin=launch.origin;
  window=new BrowserWindow({width:1450,height:950,minWidth:540,minHeight:420,show:false,...(headlessAcceptance?{offscreen:true,focusable:false}:{}),backgroundColor:'#323c4b',
    title:settings.minimal?'Alembic Viewer':'Alembic',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'persist:alembic',preload:path.join(__dirname,'preload.cjs')}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.webContents.on('did-navigate-in-page',(_event,url,isMainFrame)=>{if(isMainFrame)remember(url);});
  let preview=fragment.get('preview')||settings.preview;
  if(settings.ssh&&preview)preview='http://127.0.0.1:'+Number(settings['preview-local-port']||new URL(preview).port||80);
  const previewOrigin=preview?new URL(preview).origin:'';
  window.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(!headlessAcceptance&&viewerPermission(permission,details.requestingUrl||contents.getURL(),origin,previewOrigin)));
  window.webContents.session.setPermissionCheckHandler((_contents,permission,requestingOrigin)=>!headlessAcceptance&&viewerPermission(permission,requestingOrigin,origin,previewOrigin));
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform==='darwin'?[{role:'appMenu'}]:[]),{role:'editMenu'},{label:'View',submenu:[
    {label:'Full workspace',type:'radio',checked:!settings.minimal,click:()=>mode(false)},
    {label:'Minimal viewer',type:'radio',checked:!!settings.minimal,click:()=>mode(true)},
    {type:'separator'},{role:'reload'},{role:'togglefullscreen'},{type:'separator'},{role:'quit'}]}]));
  await window.loadURL(launch.href);loading=false;save();
  if(headlessAcceptance){
    const deadline=Date.now()+30000;let readiness=null;
    while(Date.now()<deadline){
      readiness=await window.webContents.executeJavaScript(`(()=>window.__alembic?.connectionReadiness?.()||null)()`);
      if(readiness?.error)throw new Error('Authenticated workspace startup failed: '+readiness.error);
      if(readiness?.workspaceListed&&readiness?.vmVerified&&readiness?.rootTreeListed)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!readiness?.workspaceListed||!readiness?.vmVerified||!readiness?.rootTreeListed)throw new Error('Timed out waiting for authenticated workspace, VM and root tree readiness');
    console.log('ALEMBIC_HEADLESS_READY '+JSON.stringify({urlOrigin:launch.origin,workspace:readiness.workspace,vm:readiness.vm,checks:{workspaceListed:readiness.workspaceListed,vmVerified:readiness.vmVerified,rootTreeListed:readiness.rootTreeListed},backend:'authenticated-go-api',window:'offscreen-hidden'}));
    const timeout=Math.max(1000,Math.min(60000,Number(process.env.ALEMBIC_HEADLESS_TIMEOUT_MS)||15000));
    setTimeout(()=>app.quit(),timeout).unref();
  }else window.show();
}).catch(error=>{try{const directory=app.getPath('userData');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'launch-error.log'),scrubHeadless(error.stack||error).replace(/https?:\/\/\S+/g,'<viewer URL>'));}catch{}if(headlessAcceptance){headlessFault('startup',error);try{app.quit();}catch{}}else dialog.showErrorBox('Alembic connection',error.message);});
else app.quit();
