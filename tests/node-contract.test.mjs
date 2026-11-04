import test from 'node:test';
import assert from 'node:assert/strict';
import {readExports,readPlaybacks,resolveWebPath} from '../frontend/src/node-contract.js';
import {openNodeDocument,readView,readCanvas,readNode} from '../frontend/src/canvas.js';
const bytes = text => new TextEncoder().encode(text);

test('per-render interaction rows opt in explicitly and ignore retired screen grants',()=>{
  const source='exports-index\t1\nrender\tweb\tbabylon\tweb/index.html\n';
  const parse=(extra='',path='game.i3d')=>readExports(bytes(source+extra),path).nodes[0].interaction;
  assert.deepEqual(parse(),{io_lock:false});
  assert.deepEqual(parse('interaction\tweb\tio_lock\ttrue\ninteraction\tweb\tscreen_lock\tfalse\n'),{io_lock:true});
  assert.deepEqual(parse('interaction\tweb\tscreen_lock\ttrue\n'),{io_lock:false});
  for(const extra of ['interaction\tweb\tpointer_lock\ttrue\n','interaction\tweb\tio_lock\t1\n','interaction\tmissing\tio_lock\ttrue\n','interaction\tweb\tio_lock\tfalse\ninteraction\tweb\tio_lock\ttrue\n'])assert.throws(()=>parse(extra),/interaction permissions/);
  assert.throws(()=>parse('interaction\tweb\tscreen_lock\ttrue\n','game.i2d'),/Invalid render export/);
  assert.throws(()=>readExports(bytes('exports-index\t1\nrender\tsvg\tsvg\tpreview.svg\ninteraction\tsvg\tscreen_lock\ttrue\n'),'game.i3d'),/Invalid render export/);
  const view=readView(bytes('view-index\t1\ndefault\truntime\nview\truntime\tgodot\tgame.stream\ninteraction\truntime\tio_lock\ttrue\n'),'game.i3d');
  assert.deepEqual(view.nodes[0].interaction,{io_lock:true});
  const graph={format:'alembic.canvas',version:1,title:'Legacy',nodes:[{id:'web',path:'index.html',label:'Web',inputs:[],interaction:{screen_lock:true}}],views:['web'],defaultView:'web'};
  for (const threeD of [undefined, true, false])
    assert.deepEqual(readCanvas(bytes(JSON.stringify(graph)),threeD).nodes[0].interaction,{io_lock:false});
  assert.deepEqual(readNode(bytes(JSON.stringify({format:'alembic.node',version:1,entry:'preview.svg',dependencies:{}})),'node.i2d').nodes[0].interaction,{io_lock:false});
});

test('typed exports produce actual render targets and typed public IDs',()=>{
  const doc=readExports(bytes('exports-index\t1\nrender\tweb\tbabylon\tweb/index.html\nrender\trifle\tglb\tassets/rifle.glb\nproperty\t*\tcapacity\tinteger\naction\tweb\tfire\ttarget:string\nevent\tweb\tshot\t-\n'),'game.i3d');
  assert.deepEqual(doc.views,['web','rifle']);assert.equal(doc.nodes[0].path,'game.i3d/web/index.html');
  assert.equal(doc.nodes[0].label,'Babylon');assert.equal(doc.nodes[1].label,'GLB');
  assert.deepEqual(doc.exports.map(row=>row.id),['capacity','fire','shot']);
  const two=readExports(bytes('exports-index\t1\nrender\trifle\tglb\tassets/rifle.glb\nrender\tarms\tglb\tassets/arms.glb\n'),'weapon.i3d');
  assert.deepEqual(two.nodes.map(node=>node.label),['GLB · rifle','GLB · arms']);
  for(const bad of ['render\tweb\tbabylon\t../outside.html','render\tweb\tbabylon\tweb/game.js','render\tweb\tbabylon\tweb/index.html\nrender\tweb\tglb\tasset.glb'])
    assert.throws(()=>readExports(bytes('exports-index\t1\n'+bad+'\n'),'game.i3d'));
});

test('public export hints ignore malformed rows without weakening render or playback validation',()=>{
  const render='render\tweb\tbabylon\tweb/index.html\n';
  const hints=[
    'property', 'event\tweb\tbad\u0000\t-', 'property\t*\tbad\tobject', 'action\tweb\tfire\ttarget:object',
    'event\tweb\tbad-name!\t-', 'property\tmissing\tammo\tinteger',
    'action\t*\tweb\t-', 'event\t*\trepeated\t-\textra',
    'property\t*\tgood\tinteger', 'action\tweb\tgood\t-', 'event\tweb\tshot\t-'
  ].join('\n')+'\n';
  for(const source of [render+hints,hints+render]) {
    const doc=readExports(bytes('exports-index\t1\n'+source),'game.i3d');
    assert.deepEqual(doc.views,['web']);
    assert.deepEqual(doc.exports.map(row=>row.id),['good','shot']);
    for(const row of ['render', 'render\tweb\tbabylon\tbad.js', 'interaction\tmissing\tio_lock\ttrue'])
      assert.throws(()=>readExports(bytes('exports-index\t1\n'+source+row+'\n'),'game.i3d'));
    assert.throws(()=>readPlaybacks(bytes('playbacks-index\t2\nproperty\t*\tbad\tobject\n'),doc));
  }
  const many=Array.from({length:140},(_,i)=>'property\t*\thint'+i+'\tinteger\n').join('');
  assert.equal(readExports(bytes('exports-index\t1\n'+many+render),'game.i3d').views[0],'web');
});

test('playbacks are own-node scenarios with bounded explicit child references',()=>{
  const doc=readExports(bytes('exports-index\t1\nrender\tweb\tbabylon\tweb/index.html\n'),'game.i3d');
  const rows=readPlaybacks(bytes('playbacks-index\t1\nscenario\tarena\tArena\tweb\tunknown\tnone\nuse\tarena\tplayer.weapon\tweapon\tfire-cycle\n'),doc);
  assert.deepEqual(rows,[{id:'arena',label:'Arena',render:'web',duration:null,seek:'none',uses:[{instance:'player.weapon',dependency:'weapon',playback:'fire-cycle'}]}]);
  for(const bad of ['scenario\tarena\tArena\tmissing\tunknown\tnone','scenario\tarena\tArena\tweb\tunknown\tseek',
    'scenario\tarena\tArena\tweb\tunknown\tnone\nscenario\tarena\tAgain\tweb\tunknown\tnone',
    'use\tarena\tplayer.weapon\tweapon\tfire-cycle'])
    assert.throws(()=>readPlaybacks(bytes('playbacks-index\t1\n'+bad+'\n'),doc));
});

test('typed directory opens its own exports without reading child assets or playbacks',async()=>{
  const files=new Map([
    ['game.i3d/.node.txt',bytes(JSON.stringify({format:'alembic.node',version:1,entry:'web/index.html',dependencies:{weapon:{path:'../weapon.i3d'}}}))],
    ['game.i3d/exports.txt',bytes('exports-index\t1\nrender\tweb\tbabylon\tweb/index.html\n')]
  ]),reads=[];
  const folder={entries:async()=>[{name:'.node.txt',directory:false},{name:'exports.txt',directory:false}],read:async path=>{reads.push(path);if(!files.has(path))throw Error('Unexpected read '+path);return files.get(path)}};
  const opened=await openNodeDocument(folder,'game.i3d',true);
  assert.equal(opened.document.canonical,true);assert.equal(opened.document.nodes[0].path,'game.i3d/web/index.html');
  assert.deepEqual(opened.dependencies,{weapon:{path:'../weapon.i3d'}});
  assert.deepEqual(reads,['game.i3d/.node.txt','game.i3d/exports.txt']);
});

test('standalone and nested compositions resolve the same declared source bytes',async()=>{
  const table=new Map([
    ['game.i3d',{map:{path:'../shushtar.map.i3d'},player:{path:'../player.i3d'}}],
    ['shushtar.map.i3d',{art:{path:'../shared-art'}}],
    ['player.i3d',{weapon:{path:'../weapon.i3d'}}],
    ['weapon.i3d',{art:{path:'../shared-art'}}]
  ]),nested=async node=>{if(!table.has(node))throw Error('Missing descriptor');return table.get(node)};
  const paths=[
    ['shushtar.map.i3d','_deps/art/art.js','shared-art/art.js'],
    ['game.i3d','_deps/map/_deps/art/art.js','shared-art/art.js'],
    ['game.i3d','_deps/map/map.js','shushtar.map.i3d/map.js'],
    ['game.i3d','_deps/player/_deps/weapon/_deps/art/art.js','shared-art/art.js'],
    ['game.i3d','_deps/map/_deps/art/texture.png','shared-art/texture.png']
  ];
  for(const [root,request,expected] of paths)
    assert.equal(await resolveWebPath(root,request,table.get(root),nested),expected,request);
  const sources=new Map([['shared-art/art.js',bytes('export const color = "blue"')]]);
  const standalone=await resolveWebPath('shushtar.map.i3d','_deps/art/art.js',table.get('shushtar.map.i3d'),nested);
  const composed=await resolveWebPath('game.i3d','_deps/map/_deps/art/art.js',table.get('game.i3d'),nested);
  assert.equal(sources.get(standalone),sources.get(composed),'same source object, no copy');
  for(const bad of ['_deps/missing/map.js','_deps/map/_deps/renamed/art.js','_deps/map/../secret.js','_deps/map/.node.txt',
    '_deps/map/_deps/art/_deps/again/file.js','_deps/map/_deps/art/_deps/art/_deps/art/_deps/art/_deps/art/_deps/art/_deps/art/_deps/art/file.js'])
    await assert.rejects(resolveWebPath('game.i3d',bad,table.get('game.i3d'),nested),undefined,bad);
  await assert.rejects(resolveWebPath('game.i3d','_deps/map/_deps/art/art.js',table.get('game.i3d'),async()=>{throw Error('Missing descriptor')}),/Missing descriptor/);
});

// The format table is shared with agents; scenario scripts are never interpreted here.
import {types,extensions} from '../frontend/src/contract/types.js';
import {validateRender,validateRenderEffect} from '../frontend/src/contract/rules.js';
for(const [type,spec] of Object.entries(types)) for(const format of spec.formats) test(`${type} render ${format} and playback indexes 1/2`,()=>{
  const path='node.'+type,file='source.'+(extensions[format]?.[0]||format);
  const doc=readExports(bytes(`exports-index\t1\nrender\tmain\t${format}\t${file}\n`),path);
  assert.deepEqual(doc.views,['main']);assert.equal(doc.defaultView,'main');assert.equal(doc.nodes[0].format,format);
  for(const version of [1,2]) for(const duration of ['1.25','unknown']) {
    const script='own language: () => {\n\treturn "opaque";\n}';
    const rows=readPlaybacks(bytes(`playbacks-index\t${version}\nscenario\trun\tRun\tmain\t${duration}\truntime${version===2?'\t'+JSON.stringify(script):''}\n`),doc);
    assert.equal(rows.length,1);assert.equal(rows[0].duration,duration==='unknown'?null:1.25);assert.equal(rows[0].script,version===2?script:undefined);
  }
  for(const other of Object.keys(types).filter(k=>k!==type))assert.throws(()=>readExports(bytes(`exports-index\t1\nrender\tmain\t${format}\t${file}\n`),'node.'+other),/Invalid render export/);
});
test('format boundaries, child types, visible effects and malformed version 2 fail',()=>{
  for(const format of ['godot','stream'])assert.throws(()=>validateRender('node.i3d',format,'view.stream',{child:true}),/child/);
  for(const format of ['babylon','glb','gltf'])validateRender('node.i3d',format,'view.'+(extensions[format]?.[0]||format),{child:true});
  for(const effect of [{scene3D:true},{camera3D:true}])assert.throws(()=>validateRenderEffect('node.i2d',effect),/3D/);
  assert.throws(()=>validateRenderEffect('node.i3d',{visibleText:['HUD']}),/DOM text/);
  validateRenderEffect('node.i2d',{});validateRenderEffect('node.i3d',{});
  const doc=readExports(bytes('exports-index\t1\nrender\tmain\tglb\tmodel.glb\n'),'node.i3d');
  for(const tail of ['', '\tundefined','\tnull','\t{}','\t""','\t"script"\textra'])assert.throws(()=>readPlaybacks(bytes('playbacks-index\t2\nscenario\trun\tRun\tmain\tunknown\tnone'+tail+'\n'),doc));
  for(const row of ['render\tx\tthree\tmodel.glb','render\tx\tglb\tmodel.html','render\tx\tglb\t../model.glb','view\tx\tglb\tmodel.glb'])assert.throws(()=>readExports(bytes('exports-index\t1\n'+row+'\n'),'node.i3d'));
  assert.throws(()=>readExports(bytes('exports-index\t1\n'),'node.i3d'));
});
test('iframe app URLs are declared resources; backend commands are no longer records',()=>{
 const url='http://localhost:5173',head='exports-index\t1\nrender\tapp\tapp\t';
 const doc=readExports(bytes(head+url+'\n'),'page.iframe');
 assert.equal(doc.nodes[0].url,url);assert.equal(doc.nodes[0].path,'page.iframe/__remote__/'+encodeURIComponent(url)+'/index.html');
 assert.throws(()=>readExports(bytes(head+url+'\nbackend\t5173\tstart\n'),'page.iframe'),/record/);
 for(const bad of ['http://user@localhost:5173','https://localhost:5173','http://localhost:5173/#secret'])assert.throws(()=>readExports(bytes(head+bad+'\n'),'page.iframe'));
});
