import test from 'node:test';
import assert from 'node:assert/strict';
import {openNodeDocument, readView, childNodes} from '../frontend/src/canvas.js';
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const descriptor = {format:'alembic.node',version:1,title:'Example',entry:'mesh.glb',dependencies:{}};
const viewText = text => new TextEncoder().encode(text);
// Listings derive from the file map, and reads/listings are counted, so descriptor
// selection can prove it never probes an absent descriptor or lists twice.
function folder(files) {
  const rows = dir => {
    const prefix = dir ? dir + '/' : '';
    const names = new Map();
    for (const path of Object.keys(files)) if (path.startsWith(prefix) && path.length > prefix.length) {
      const [name, ...rest] = path.slice(prefix.length).split('/');
      names.set(name, rest.length > 0);
    }
    return [...names].map(([name, directory]) => ({name, directory}));
  };
  const reads = [], listed = [];
  return {
    reads, listed,
    async list(dir = '') { listed.push(dir); return rows(dir); },
    async entries(dir = '') { listed.push(dir); return rows(dir); },
    async read(path) {
      reads.push(path);
      if (!(path in files)) throw Object.assign(new Error(`Missing ${path}`), {name: 'NotFoundError'});
      return files[path];
    }
  };
}
test('malformed hidden descriptor fails rather than falling back to legacy data',async()=>{
  await assert.rejects(openNodeDocument(folder({'scene.i3d/.node.txt':bytes({invalid:true})}),'scene.i3d'));
});
test('retired native view declarations fail visibly', () => {
  const index = viewText('view-index\t1\ndefault\truntime\nview\truntime\tgodot\truntime.html\n');
  assert.throws(() => readView(index, 'scene.i3d'), /unsupported for now/);
});
test('view.txt rejects missing context and invalid records rather than exposing an unbound action',()=>{
  for (const text of [
    'view-index\t1\ndefault\ta\nview\ta\tglb\tmesh.glb\naction\ta\tFire\tkey:f\n',
    'view-index\t1\ndefault\ta\nview\ta\tgodot\truntime.stream\naction\tmissing\tFire\tkey:f\n',
    'view-index\t1\ndefault\ta\nview\ta\tgodot\truntime.stream\naction\ta\tRun\tkey:Ctrl\n',
    'view-index\t1\ndefault\ta\nview\ta\tglb\t../../escape.glb\n',
    'view-index\t1\ndefault\ta\nview\ta\tglb\tmesh.glb\ncontext\tanything\n'
  ]) assert.throws(()=>readView(viewText(text),'scene.i3d'));
});
test('child playback discovery reads only direct node metadata, deduplicates links and excludes cycles and states',async()=>{
  const child={format:'alembic.node',version:1,entry:'mesh.glb',dependencies:{weapon:{path:'../weapon.i3d'},duplicate:{path:'../weapon.i3d'},self:{path:'.'},tool:{state:'sha256:'+'a'.repeat(64)}}};
  const f=folder({'game.i3d/.node.txt':bytes(child),'game.i3d/inner.i3d/.node.txt':bytes(descriptor),'weapon.i3d/.node.txt':bytes(descriptor),'weapon.i3d/assets/mesh.glb':Buffer.from('asset')});
  assert.deepEqual(await childNodes(f,'game.i3d',['weapon.i3d']),['game.i3d/inner.i3d']);
  assert.deepEqual(f.reads,['game.i3d/.node.txt']);
  assert.deepEqual(await childNodes(f,'game.i3d'),['game.i3d/inner.i3d','weapon.i3d']);
  assert.ok(!f.reads.some(path=>path.endsWith('.glb')||path.endsWith('.stream')));
});
test('child discovery reports its bound instead of silently dropping exported nodes',async()=>{
  const files={'parent.i3d/.node.txt':bytes(descriptor)};
  for(let i=0;i<65;i++)files[`parent.i3d/item${i}.i3d/.node.txt`]=bytes(descriptor);
  await assert.rejects(childNodes(folder(files),'parent.i3d'),/More than 64 child nodes/);
});
for (const file of ['.node.txt','manifest.json']) for (const known of [true,undefined])
  test(`${file}: known=${known === true} reads only the listed descriptor`,async()=>{
    const path='scene.i3d/'+file, f=folder({[path]:bytes({...descriptor,title:'New'})});
    const node=await openNodeDocument(f,'scene.i3d',known);
    assert.equal(node.source,path);
    assert.equal(node.directory,true);
    assert.equal(node.document.title,'New');
    assert.deepEqual(f.listed,known ? ['scene.i3d'] : ['','scene.i3d']);
    assert.deepEqual(f.reads,[path]);
  });
test('simultaneous descriptors are rejected instead of silently hiding divergent content',async()=>{
  const both=folder({'scene.i3d/.node.txt':bytes(descriptor),'scene.i3d/manifest.json':bytes({...descriptor,title:'Other'})});
  await assert.rejects(openNodeDocument(both,'scene.i3d'),/Both \.node\.txt and manifest\.json exist/);
  assert.deepEqual(both.listed,['','scene.i3d']);
  assert.deepEqual(both.reads,[]);                         // refused from the listing before any descriptor read
});
test('a package without any descriptor reports it without probing reads',async()=>{
  const empty=folder({'scene.i3d/mesh.glb':bytes('{}')});
  await assert.rejects(openNodeDocument(empty,'scene.i3d',true),/Node descriptor is missing/);
  assert.deepEqual(empty.listed,['scene.i3d']);
  assert.deepEqual(empty.reads,[]);
});
test('standalone typed composition keeps its graph and views',async()=>{
  const doc={format:'alembic.composition',version:1,title:'Sniper',primaryView:'3d',defaultView:'native',views:
    ['native'],nodes:[{id:'native',path:'Sniper.html',label:'Play',inputs:[]}]};
  const source=bytes(doc), f=folder({'Sniper.i3d':source});
  const result=await openNodeDocument(f,'Sniper.i3d');
  assert.equal(result.document.format,'alembic.canvas');assert.equal(result.document.primaryView,'3d');
  assert.equal(result.document.nodes[0].path,'Sniper.html');
    assert.equal(JSON.parse(new TextDecoder().decode(source)).format,'alembic.composition');
  assert.equal(result.directory,false);assert.deepEqual(f.listed,['']);assert.deepEqual(f.reads,['Sniper.i3d']);
  const known=folder({'Sniper.i3d':bytes(doc)});
  const direct=await openNodeDocument(known,'Sniper.i3d',false);  // a known file entry reads without any listing
  assert.equal(direct.source,'Sniper.i3d');assert.deepEqual(known.listed,[]);
});

test('top-level package graph resolves node paths and preserves project-relative receipt resources',async()=>{
  const hash='a'.repeat(64), doc={format:'alembic.node',version:1,title:'Main',entry:'preview.html',dependencies:{},
    defaultView:'review',views:['native','review'],nodes:[
    {id:'source',path:'main.gd',label:'Source',inputs:[]},
    {id:'native',path:'preview.html',label:'Play',inputs:['source']},
    {id:'review',path:'../../test_vids/review.mp4',label:'Review',inputs:['source'],receipt:{output:hash,inputs:{source:hash},resources:{'main/effects.i3d/effects.gd':hash}}}
  ]};
  const result=await openNodeDocument(folder({'scene.i3d/.node.txt':bytes(doc)}),'scene.i3d').catch(e=>e);
  assert.match(result.message,/escapes project/);
  const graph=(await openNodeDocument(folder({'main/main.i3d/.node.txt':bytes(doc)}),'main/main.i3d')).document;
  assert.deepEqual(graph.views,['native','review']);assert.equal(graph.nodes[1].path,'main/main.i3d/preview.html');
  assert.equal(graph.nodes[2].path,'test_vids/review.mp4');assert.deepEqual(graph.nodes[2].receipt.resources,{'main/effects.i3d/effects.gd':hash});
});
