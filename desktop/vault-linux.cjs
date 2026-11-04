// Explicit Windows shell -> existing Elixir WSL adapter. Credentials stay in pipes/memory.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const hidden=process.argv.includes('--alembic-headless-acceptance')||process.env.ALEMBIC_HEADLESS_ACCEPTANCE==='1';
function clean(error){return String(error?.message||error).replace(/https?:\/\/\S+/g,'<connection URL>').replace(/Bearer\s+\S+/ig,'Bearer <redacted>');}
if(hidden){
 if(!process.env.APPDATA||!path.isAbsolute(process.env.APPDATA))throw new Error('Private acceptance requires disposable APPDATA');
 app.setPath('appData',process.env.APPDATA);
 for(const s of ['disable-notifications','disable-component-update','disable-background-networking'])app.commandLine.appendSwitch(s);
 app.commandLine.appendSwitch('disable-features','Notifications,PushMessaging');
}
app.setName('Alembic');
app.setPath('userData',path.join(app.getPath('appData'),'Alembic','vault-linux'));
const cfgPath=process.env.ALEMBIC_WINDOWS_CONFIG||path.join(process.env.USERPROFILE,'.alembic','desktop.txt');
let window,connecting=false;
function settings(){
 const c=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
 if(c.schema_version!==1||typeof c.wsl_distro!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(c.linux_install)||typeof c.selected_linux_project!=='string'||!c.selected_linux_project.startsWith('/'))throw new Error('Linux desktop settings are invalid');
 return c;
}
function handoff(c){return new Promise((resolve,reject)=>{
 const child=spawn(path.join(process.env.SYSTEMROOT,'System32','wsl.exe'),['-d',c.wsl_distro,'--','python3',c.linux_install+'/desktop/linux_connection.py','--project',c.selected_linux_project],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('Linux project connection timed out'));},45000);
 child.stdout.on('data',b=>{out+=b;if(out.length>1048576){child.kill();reject(new Error('Connection response exceeded limit'));}});
 child.stderr.on('data',b=>{err+=b;if(err.length>8192)err=err.slice(-8192);});
 child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('Elixir Linux connection failed: '+clean(err)));try{const d=JSON.parse(out);const u=new URL(d.url);if(d.proof?.backend!=='linux-elixir'||u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||!d.proof.checks.workspaceListed||!d.proof.checks.vmVerified||!d.proof.checks.rootTreeListed)throw new Error('Invalid authenticated Linux handoff');resolve(d);}catch(e){reject(e);}});
});}
async function connect(){
 if(connecting)return;connecting=true;
 try{
  const d=await handoff(settings()),origin=new URL(d.url).origin,previewOrigin=new URL(d.preview_origin).origin;
  if(!window){
   window=new BrowserWindow({title:'Alembic — '+d.proof.project.name,width:1440,height:900,backgroundColor:'#333d4b',autoHideMenuBar:true,show:false,...(hidden?{offscreen:true,focusable:false}:{}),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
   window.webContents.on('will-navigate',(e,url)=>{if(new URL(url).origin!==origin)e.preventDefault();});
   window.webContents.setWindowOpenHandler(({url})=>{try{const u=new URL(url);if(!hidden&&[origin,previewOrigin].includes(u.origin))return{action:'allow'};}catch{}return{action:'deny'};});
   const permitted=(permission,url)=>{let at;try{at=new URL(url).origin;}catch{return false;}return !hidden&&((['fullscreen','pointerLock'].includes(permission)&&[origin,previewOrigin].includes(at))||(['clipboard-read','clipboard-sanitized-write'].includes(permission)&&at===origin));};
   window.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(permitted(permission,details.requestingUrl||contents.getURL())));
   window.webContents.session.setPermissionCheckHandler((_contents,permission,at)=>permitted(permission,at));
  }
  await window.loadURL(d.url);
  if(hidden){
   const deadline=Date.now()+30000;let data;
   do{data=await window.webContents.executeJavaScript(`(()=>({title:document.title,body:document.body.innerText,scripts:[...document.scripts].map(s=>s.src),readiness:window.__alembic?.connectionReadiness?.()||null}))()`);if(d.proof.node_views.every(n=>data.body.includes(n.name.replace(/\.(i3d|i2d|audio)$/,''))))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
   if(!d.proof.node_views.every(n=>data.body.includes(n.name.replace(/\.(i3d|i2d|audio)$/,''))))throw new Error('Installed node view list did not become ready');
   if(!data.scripts.some(s=>new URL(s).pathname===d.proof.frontend.script))throw new Error('Loaded frontend does not match authenticated handoff');
   const receipt={...d.proof,window:'offscreen-hidden',dom:{title:data.title,nodeNames:d.proof.node_views.filter(n=>data.body.includes(n.name.replace(/\.(i3d|i2d|audio)$/,''))).map(n=>n.name)}};
   console.log('ALEMBIC_HEADLESS_READY '+JSON.stringify(receipt));
   if(process.env.ALEMBIC_ROUTING_RECEIPT)fs.writeFileSync(process.env.ALEMBIC_ROUTING_RECEIPT,JSON.stringify(receipt));
   setTimeout(()=>app.quit(),1000);
  }else window.show();
 }finally{connecting=false;}
}
function fail(e){const message=clean(e);if(hidden){console.error('ALEMBIC_HEADLESS_ERROR '+JSON.stringify({stage:'linux-elixir-routing',message}));app.exit(1);}else{dialog.showErrorBox('Alembic connection',message);app.quit();}}
const primary=app.requestSingleInstanceLock();
if(!primary)app.quit();
else{app.on('second-instance',()=>{connect().then(()=>{if(window?.isMinimized())window.restore();window?.focus();}).catch(fail);});app.whenReady().then(connect).catch(fail);}
app.on('window-all-closed',()=>app.quit());
