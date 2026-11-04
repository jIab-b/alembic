import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),read=path=>readFile(new URL(path,root));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(dir){return (await Promise.all((await readdir(new URL(dir,root),{withFileTypes:true})).filter(e=>
  !['node_modules','dist','examples'].includes(e.name)).map(e=>e.isDirectory()?files(dir+'/'+e.name):
    [dir+'/'+e.name]))).flat()}
test('main working-tree UI hashes are frozen with explicit exceptions',async()=>{
 const reference=JSON.parse(await read('frontend/parity-reference.json'));
 const allow=new Map((await read('frontend/parity-allowlist.txt')).toString().trim().split('\n').map(line=>line.split('\t')));
 for(const [source,path,sha,accepted] of reference){
  if(accepted==='deleted') await assert.rejects(read(path),{code:'ENOENT'});
  else assert.equal(hash(await read(path)),accepted||sha,source+' drifted');
  assert.equal(allow.has(path),!!accepted,path+' must have exactly one explained exception');
  if(accepted){assert.ok(allow.get(path));allow.delete(path)}
 }
 assert.equal(allow.size,0);
 const known=new Set(reference.map(row=>row[1]));
 for(const path of [...await files('frontend/src'),...await files('frontend/public')])assert.ok(known.has(path)||path.startsWith('frontend/src/contract/')||path.startsWith('frontend/public/assets/runtimes/'),'Unreviewed UI file: '+path);
});
test('authored frontend has no engine imports',async()=>{
 for(const path of await files('frontend')) if(/\.(?:js|ts|svelte|html|cjs|mjs)$/.test(path)){
  const source=(await read(path)).toString();
  assert.doesNotMatch(source,/(?:from\s*|import(?:\.meta\.glob)?\s*\(?\s*|require\s*\(\s*)['"](?:[^'"]*\/)?(?:three(?:[@/'"]|$)|@babylonjs\/)/,path);
  if(path.startsWith('frontend/src/'))assert.doesNotMatch(source,/babylon|godot|glb|gltf|html2d|webaudio/i,path);
  assert.doesNotMatch(source,/<script[^>]+src=['"][^'"]*(?:three|babylon)/i,path);
 }
});
