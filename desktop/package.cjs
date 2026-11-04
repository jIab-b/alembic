// All platforms use the same shell and the frontend served by the existing Vault.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {version}=require('electron/package.json');
async function main() {
  const options={platform:process.platform,arch:process.arch};
  for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].replace(/^--/,'');if(!['platform','arch','runtime-zip'].includes(key)||!process.argv[i+1])throw new Error('Use --platform linux|win32|darwin --arch x64|arm64 [--runtime-zip FILE]');options[key]=process.argv[i+1];}
  if(!['linux','win32','darwin'].includes(options.platform)||!['x64','arm64'].includes(options.arch))throw new Error('Unsupported platform or architecture');
  const target=path.join(__dirname,'out',`alembic-${options.platform}-${options.arch}`);
  fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});
  if(options['runtime-zip']||options.platform!==process.platform||options.arch!==process.arch) {
    const name=`electron-v${version}-${options.platform}-${options.arch}.zip`, checksums=require('electron/checksums.json');
    const zip=options['runtime-zip']||await require('@electron/get').downloadArtifact({version,artifactName:'electron',platform:options.platform,arch:options.arch,checksums});
    const actual=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    if(actual!==checksums[name])throw new Error('Electron runtime checksum mismatch');
    await require('@electron-internal/extract-zip').extract(path.resolve(zip),{dir:target});
  } else fs.cpSync(path.join(path.dirname(require.resolve('electron/package.json')),'dist'),target,{recursive:true});
  let app=path.join(target,'resources','app'),executable;
  if(options.platform==='darwin') {
    const bundle=path.join(target,'Alembic.app');fs.renameSync(path.join(target,'Electron.app'),bundle);
    app=path.join(bundle,'Contents','Resources','app');executable=path.join(bundle,'Contents','MacOS','Alembic');
    fs.renameSync(path.join(bundle,'Contents','MacOS','Electron'),executable);
    const plist=path.join(bundle,'Contents','Info.plist');let text=fs.readFileSync(plist,'utf8');
    for(const [key,value] of Object.entries({CFBundleName:'Alembic',CFBundleDisplayName:'Alembic',CFBundleExecutable:'Alembic',CFBundleIdentifier:'com.clockworktower.alembic'}))text=text.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`),`$1${value}$2`);
    fs.writeFileSync(plist,text);
    if(process.platform==='darwin'){const result=require('node:child_process').spawnSync('codesign',['--force','--deep','--sign','-',bundle],{stdio:'inherit'});if(result.status!==0)throw new Error('Development signing failed');}
    else console.warn('Sign this development .app on macOS before running it.');
  } else {
    const suffix=options.platform==='win32'?'.exe':'';executable=path.join(target,'alembic'+suffix);fs.renameSync(path.join(target,'electron'+suffix),executable);
  }
  fs.mkdirSync(app,{recursive:true});for(const file of ['package.json','main.cjs','connection.cjs','preload.cjs'])fs.copyFileSync(path.join(__dirname,file),path.join(app,file));
  console.log(executable);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
