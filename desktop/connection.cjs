const {spawn} = require('node:child_process');
const net = require('node:net');
function launchOptions(argv, saved = {}) {
  const options = {...saved};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--direct') delete options.ssh;
    else if (arg === '--minimal' || arg === '--full') options.minimal = arg === '--minimal';
    else if (['--url','--connect','--ssh','--local-port','--preview-local-port'].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
      options[arg === '--connect' ? 'url' : arg.slice(2)] = argv[++i];
    } else throw new Error('Unknown option: ' + arg);
  }
  if (!options.url) throw new Error('Pass --connect with the project launch URL the first time.');
  const url = new URL(options.url);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password)
    throw new Error('Use the loopback backend URL; --ssh forwards that endpoint from the remote host.');
  for (const key of ['local-port','preview-local-port']) if (options[key] !== undefined && (!/^\d+$/.test(String(options[key])) || Number(options[key]) < 1 || Number(options[key]) > 65535))
    throw new Error('Invalid ' + key);
  if (options.ssh && (typeof options.ssh !== 'string' || !/^[\w@.:[\]-]+$/.test(options.ssh) || options.ssh.startsWith('-')))
    throw new Error('Use an SSH config alias or user@host.');
  const fragment = new URLSearchParams(url.hash.slice(1));
  const preview = fragment.get('preview') || options.preview;
  if (preview) {
    const p = new URL(preview);
    if (p.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(p.hostname) || p.username || p.password || p.pathname !== '/' || p.search || p.hash)
      throw new Error('Invalid isolated preview URL');
  }
  const forwards = [];
  if (options.ssh) {
    const port = Number(url.port || 80), local = Number(options['local-port'] || port);
    forwards.push({local, remote:port}); url.hostname = '127.0.0.1'; url.port = String(local);
    if (fragment.has('token') || fragment.has('grant')) fragment.set('node',url.origin);
    if (preview) {
      const remote = Number(new URL(preview).port || 80), local = Number(options['preview-local-port'] || remote);
      if (forwards.some(f=>f.local === local)) throw new Error('Controller and preview need different local ports');
      forwards.push({local,remote}); if (fragment.has('token') || fragment.has('grant')) fragment.set('preview','http://127.0.0.1:'+local);
    }
  }
  if (fragment.size) url.hash = fragment.toString();
  if (options.minimal) url.searchParams.set('layout','minimal'); else url.searchParams.delete('layout');
  delete options.nativeFrames;url.searchParams.delete('native');
  return {options, url:url.href, forwards};
}
function sshArgv(target, forwards) {
  return ['-N','-T','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',
    ...forwards.flatMap(f=>['-L',`127.0.0.1:${f.local}:127.0.0.1:${f.remote}`]),'--',target];
}
async function tunnel(target, forwards, onexit) {
  let stopped = false, failure, child;
  // Refuse occupied ports; never accidentally attach to an unrelated local service.
  for (const forward of forwards) await new Promise((resolve,reject)=>{
    const probe=net.createServer();probe.once('error',reject);probe.listen(forward.local,'127.0.0.1',()=>probe.close(resolve));
  });
  child=spawn('ssh',sshArgv(target,forwards),{stdio:['ignore','ignore','pipe'],windowsHide:true});
  let detail='';child.stderr.on('data',b=>detail=(detail+b).slice(-2000));
  child.on('error',e=>failure=e);child.on('exit',(code)=>{failure=new Error(detail.trim() || `SSH tunnel ended (${code})`);if(!stopped)onexit(failure);});
  const close=()=>{stopped=true;child.kill();};
  try {
    const deadline=Date.now()+15000;
    for (const forward of forwards) {
      while (true) {
        if (failure) throw failure;
        if (Date.now()>deadline) throw new Error('SSH forwarding timed out. Check the SSH config and key authentication.');
        if (await new Promise(resolve=>{const socket=net.connect(forward.local,'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));})) break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
    }
    if (failure) throw failure;
    return close;
  } catch(e) {close();throw e;}
}
function viewerPermission(permission, url, controller, preview) {
  let origin;try{origin=new URL(url).origin;}catch{return false;}
  if (['fullscreen','pointerLock'].includes(permission)) return origin===controller || origin===preview;
  return origin===controller && ['clipboard-read','clipboard-sanitized-write'].includes(permission);
}
module.exports={launchOptions,sshArgv,tunnel,viewerPermission};
