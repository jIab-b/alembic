import test from 'node:test';
import assert from 'node:assert/strict';
import {readCanvas, canvasLayout, canvasStatus, canvasInspector} from '../frontend/src/canvas.js';
const a='a'.repeat(64), b='b'.repeat(64), c='c'.repeat(64), encode = doc => new TextEncoder().encode(JSON.stringify(doc));
const fixture=()=>({format:'alembic.canvas',version:1,title:'Castle',defaultView:'model',views:['model','play'],nodes:[
  {id:'source',label:'Blender',path:'castle.blend',inputs:[]},
  {id:'model',label:'3D',path:'castle.glb',inputs:['source'],receipt:{inputs:{source:a},output:b}},
  {id:'play',label:'Play',path:'build/index.html',inputs:['model'],receipt:{inputs:{model:b},output:c,resources:{'build/index.pck':b}}}
]});
test('canvas rejects escapes, cycles, nested canvases, missing references and invalid receipts',()=>{
  const doc=readCanvas(encode(fixture()));assert.equal(doc.nodes.length,3);
  for(const change of [d=>d.nodes[0].path='../private',d=>d.nodes[0].inputs=['play'],d=>d.nodes[1].inputs=['missing'],d=>d.nodes[0].path='other.canvas',d=>d.nodes[0].id='model',d=>d.defaultView='missing',d=>d.nodes[1].receipt.output='not a digest',d=>d.nodes[2].receipt.resources={'../private':a}]){
    const bad=fixture();change(bad);assert.throws(()=>readCanvas(encode(bad)),/Invalid canvas/);
  }
  const layout=canvasLayout(doc);assert.ok(layout[0].x<layout[1].x&&layout[1].x<layout[2].x);
});
test('render view labels come from the registry',()=>{
  const doc={format:'alembic.canvas',version:1,title:'Weapon',defaultView:'asset',views:['asset','arms'],nodes:[
    {id:'asset',path:'rifle.glb',inputs:[]},{id:'arms',path:'arms.glb',inputs:[]}]};
  assert.deepEqual(readCanvas(encode(doc)).nodes.map(n=>n.label),['GLB · rifle','GLB · arms']);
  doc.nodes[1].label='Custom';assert.equal(readCanvas(encode(doc)).nodes[1].label,'Custom');
});
test('freshness checks exact outputs, inputs, resources and transitive dependency state',async()=>{
  const doc=fixture(),files=new Map([['castle.blend',a],['castle.glb',b],['build/index.html',c],['build/index.pck',b]]);
  const inspect=()=>canvasStatus(doc,path=>files.get(path));
  assert.deepEqual(Object.values(await inspect()).map(n=>n.state),['source','current','current']);
  files.set('castle.blend',c);let status=await inspect();assert.equal(status.model.state,'stale');assert.equal(status.play.state,'stale');
  files.set('castle.blend',a);files.set('build/index.pck',a);assert.equal((await inspect()).play.state,'stale');
  files.set('build/index.pck',b);files.delete('castle.glb');status=await inspect();assert.equal(status.model.state,'missing');assert.equal(status.play.state,'stale');
  files.set('castle.glb',b);delete doc.nodes[1].receipt;assert.equal((await inspect()).model.state,'unverified');
  doc.nodes[2].build={state:'failed',message:'Import failed'};status=await inspect();assert.equal(status.play.state,'failed');assert.equal(status.play.hash,c);
});

test('background inspection bounds reads and discards an obsolete view', async () => {
  const doc = fixture(), calls = [], results = [];
  let release;
  const gate = new Promise(resolve => release = resolve);
  const inspector = canvasInspector(async (context, path) => {
    calls.push([context, path]);
    if (context === 'old') await gate;
    return ({'castle.blend':a,'castle.glb':b,'build/index.html':c,'build/index.pck':b})[path];
  }, (context, status) => results.push([context, status]), 1);
  inspector.request(doc, 'old');
  await new Promise(resolve => setTimeout(resolve, 0));
  inspector.request(doc, 'new');
  release();
  while (inspector.busy) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.filter(([context]) => context === 'old').length, 1);
  assert.deepEqual(results.map(([context]) => context), ['new']);
  assert.equal(results[0][1].play.state, 'current');
});

test('typed node owns its entry and embedded composition without a wrapper', async () => {
  const {readNode} = await import('../frontend/src/canvas.js');
  const encode = doc => new TextEncoder().encode(JSON.stringify(doc));
  const node = {format:'alembic.node',version:1,entry:'preview.svg',dependencies:{}};
  const simple = readNode(encode(node),'world.i3d');
  assert.equal(simple.nodes[0].path,'world.i3d/preview.svg');
  const scene = fixture();
  scene.nodes[0].path = '../sources/world.blend';
  node.scene = scene;
  assert.equal(readNode(encode(node),'world.i3d').nodes[0].path,'sources/world.blend');
  node.scene.nodes[0].path = '../../escape.blend';
  assert.throws(() => readNode(encode(node),'world.i3d'), /escapes project/);
  delete node.scene; node.entry = '../escape.svg';
  assert.throws(() => readNode(encode(node),'world.i3d'), /manifest/);
});
