import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, symlink, rm, access, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readPreviewFile, PREVIEW_FILE_LIMIT} from '../frontend/src/preview-file.js';

// The test stands in for the VM wrapper with a disposable directory, executing
// the real reader command and streaming its output through the same parser.
function fixtureClient(directory, transform = text => text) {
  const scope = new AbortController(), calls = [];
  return {scope, calls, v: op => '/vms/v1/' + op,
    async json(path, body) { assert.equal(path,'/vms/v1/shell-client');assert.deepEqual(body,{});return {executable:'/trusted/vm-shell'}; },
    async call(argv) {
      assert.equal(argv[0],'/trusted/vm-shell');calls.push(argv);
      const child=spawn('/bin/sh',['-c',argv[1]],{cwd:directory,stdio:['ignore','pipe','pipe']});
      const socket={close(){if(child.exitCode===null)child.kill();}};
      child.stdout.on('data', bytes=>socket.onmessage?.({data:transform(bytes.toString())}));
      child.stderr.on('data', bytes=>socket.onmessage?.({data:bytes.toString()}));
      child.once('close',()=>socket.onclose?.());
      return socket;
    }
  };
}
test('large VM reader preserves quoted paths and validates streamed bytes, size and checksum',async()=>{
  const root=await mkdtemp(join(tmpdir(),'alembic-preview-reader-'));
  try{
    const path="quoted ' $(touch leaked).wasm", bytes=Buffer.alloc(17*1024*1024+13);
    for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
    await writeFile(join(root,path),bytes);
    await writeFile(join(root,'base64.py'),"raise RuntimeError('Project modules must not execute during preview reads')");
    const client=fixtureClient(root);
    const one=readPreviewFile(client,path,bytes.length),two=readPreviewFile(client,path,bytes.length);
    assert.equal(one,two,'concurrent identical reads share one VM call');
    assert.deepEqual(Buffer.from(await one),bytes);assert.equal(client.calls.length,1);
    await assert.rejects(access(join(root,'leaked')), {code:'ENOENT'});
    await assert.rejects(readPreviewFile(client,path,bytes.length-1),/size changed/);
    await symlink(path,join(root,'link.wasm'));
    await assert.rejects(readPreviewFile(client,'link.wasm',bytes.length),/symbolic links/i);
    await mkdir(join(root,'nested'));await writeFile(join(root,'nested','small.bin'),'safe');
    await symlink('nested',join(root,'linked-dir'));
    await assert.rejects(readPreviewFile(client,'linked-dir/small.bin',4),/directory|symbolic links/i);
    await assert.rejects(readPreviewFile(client,'../escape',1),/Invalid preview path/);
    await assert.rejects(readPreviewFile(client,'.secret',1),/Invalid preview path/);
    await assert.rejects(readPreviewFile(client,'big.wasm',PREVIEW_FILE_LIMIT+1),/128 MiB/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('the VM reader rejects corrupt data and premature termination',async()=>{
  const root=await mkdtemp(join(tmpdir(),'alembic-preview-reader-'));
  try{
    await writeFile(join(root,'small.bin'),'hello');
    // Change decoded content rather than only base64 padding bits.
    const changed=fixtureClient(root,text=>text.replace('aGVsbG8=','eGVsbG8='));
    await assert.rejects(readPreviewFile(changed,'small.bin',5),/checksum mismatch/);
    const truncated=fixtureClient(root,text=>text.split('\n').filter(line=>!line.includes(':done:')).join('\n'));
    await assert.rejects(readPreviewFile(truncated,'small.bin',5),/before completion/);
    const aborted=fixtureClient(root);aborted.scope.abort();
    await assert.rejects(readPreviewFile(aborted,'small.bin',5),/abort/i);
  }finally{await rm(root,{recursive:true,force:true});}
});
