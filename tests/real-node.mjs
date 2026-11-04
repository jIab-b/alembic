import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdir, mkdtemp, writeFile, rm, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {project, svg} from './fixture.mjs';

export async function realPrerequisite() {
  for(const name of ['VPSCTL_NODE','SW_ISOLATOR']) {
    if(!process.env[name]) return 'Missing real-node prerequisite: '+name;
    try {await access(process.env[name],constants.X_OK);} catch(e){if(['ENOENT','EACCES'].includes(e.code))return `Missing executable ${name}: ${process.env[name]}`;throw e;}
  }
  const network = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => ['EPERM','EACCES'].includes(error.code) ? resolve('Loopback TCP unavailable: '+error.code) : reject(error));
    probe.listen(0,'127.0.0.1',()=>probe.close(()=>resolve(null)));
  });
  if (network) return network;
  try{await access(homedir()+'/vspctl/vpsctl/sandbox.py');}catch(e){if(e.code==='ENOENT')return 'Missing ~/vspctl Python package';throw e;}
}
export async function serveReal() {
  await mkdir('tests/out',{recursive:true}); const root=await mkdtemp(process.cwd()+'/tests/out/real-');
  await mkdir(root+'/project');for(const [path,bytes] of project())await writeFile(root+'/project/'+path,path==='scene.svg'?svg('red'):bytes);
  const child=spawn('python3',['-u',new URL('./real-node.py',import.meta.url).pathname,root],{stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  child.stdin.on('error',()=>{});let stderr='', metadata, serial=0, pending=new Map();child.stderr.on('data',b=>stderr+=b);
  const lines=createInterface({input:child.stdout});let yes,no;
  const ready=new Promise((resolve,reject)=>{yes=resolve;no=reject;});
  lines.on('line',line=>{try{const data=JSON.parse(line);if(data.origin){metadata=data;yes(data);}else{const task=pending.get(data.id);pending.delete(data.id);data.error?task?.reject(new Error(data.error)):task?.resolve(data.result);}}catch(e){no(e);}});
  child.on('error',no);child.on('close',code=>{const e=new Error(`Real-node helper exited (${code}): ${stderr}; log: ${root}/node.log`);no(e);for(const p of pending.values())p.reject(e);pending.clear();});
  async function close() {
    if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'close');child.stdin.end(JSON.stringify({op:'close'})+'\n');
      const timer=setTimeout(()=>child.kill('SIGTERM'),10000);const kill=setTimeout(()=>child.kill('SIGKILL'),25000);
      try{await exited;}finally{clearTimeout(timer);clearTimeout(kill);}}
    lines.close();
  }
  const timer=setTimeout(()=>no(new Error('Real-node setup timeout; log: '+root+'/node.log')),60000);
  try{await ready;}catch(e){await close();throw e;}finally{clearTimeout(timer);}
  const api=async(op,...args)=>{while(args.length&&args.at(-1)===undefined)args.pop();const id=++serial;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,op,args})+'\n');});};
  return {...metadata,real:true,calls:[],typed:[],api,close:async()=>{await close();if(child.exitCode!==0)throw new Error('Real-node cleanup failed; log: '+root+'/node.log');await rm(root,{recursive:true,force:true});}};
}
