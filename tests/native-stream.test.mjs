import test from 'node:test';
import assert from 'node:assert/strict';
import {readNativeStream,readInteraction} from '../frontend/src/native-stream.js';
import {readCanvas,canvasStatus} from '../frontend/src/canvas.js';
const spec={format:'alembic.native-view',version:1,application:'blender',source:'scenes/world/master.blend',width:1280,height:800,fps:60,interaction:{io_lock:false}};
const read=value=>readNativeStream(new TextEncoder().encode(JSON.stringify(value)));

test('native interaction permissions default closed and ignore retired screen grants',()=>{
  for(const application of ['blender','godot']){
    const descriptor={...spec,application,source:application==='godot'?'game/project.godot':spec.source};delete descriptor.interaction;
    assert.deepEqual(read(descriptor).interaction,{io_lock:false});
    for(const io_lock of [false,true])for(const screen_lock of [false,true])assert.deepEqual(read({...descriptor,interaction:{io_lock,screen_lock}}).interaction,{io_lock});
  }
  for(const interaction of [null,[],true,'true',{io_lock:1},{pointer_lock:true},{io_lock:true,target:'actor'}])assert.throws(()=>read({...spec,interaction}),/interaction permissions/);
  assert.deepEqual(readInteraction({io_lock:true},{threeD:false}),{io_lock:true});
  assert.deepEqual(readInteraction(Object.create({io_lock:true})),{io_lock:false});
  assert.deepEqual(readInteraction({screen_lock:true},{threeD:false}),{io_lock:false});
});

test('native view accepts a portable source descriptor and a verified live session',()=>{
  assert.deepEqual(read(spec),spec);
  const live={...spec,control:'http://127.0.0.1:41000',whep:'http://127.0.0.1:41001/native/whep',session:'a'.repeat(32)};
  assert.deepEqual(read(live),live);
});
test('Godot native descriptors declare a project and bounded existing edit paths',()=>{
  const godot={...spec,application:'godot',source:'source/godot/project.godot',editTargets:['source/godot/world.gd','source/godot/world.tscn']};
  assert.deepEqual(read(godot),godot);
  assert.deepEqual(read({...godot,actions:[{label:'Record sound',key:'Shift_L'},{label:'Save sound',key:'Control_L'}]}).actions.map(a=>a.key),['Shift_L','Control_L']);
  for(const change of [{source:'scene.tscn'},{source:'master.blend'},{editTargets:['../escape.gd']},{editTargets:'world.gd'},{editTargets:['/tmp/world.gd']}])assert.throws(()=>read({...godot,...change}));
});
test('Godot assembly and explicit preview actions are bounded',()=>{
  const godot={...spec,application:'godot',source:'sniper_2.i3d/godot/project.godot',assembly:'coastal-weapon',actions:[{label:'Fire',key:'f'},{label:'Reload',key:'r'}]};
  assert.deepEqual(read(godot),godot);
  for(const change of [{assembly:'../../script'},{actions:[{label:'Run',key:'Ctrl'}]},{actions:[{label:'',key:'f'}]},
    {actions:[{label:'Fire',key:'f'},{label:'Again',key:'f'}]},{actions:Array(9).fill({label:'Fire',key:'f'})}])assert.throws(()=>read({...godot,...change}));
  assert.throws(()=>read({...spec,assembly:'coastal-weapon'}));
});
test('native view rejects remote services, escaping sources and malformed stream bounds',()=>{
  for(const change of [{source:'../master.blend'},{source:'scenes\\master.blend'},{source:'/tmp/master.blend'},{source:'scene.gltf'},{width:10000},{fps:0},{application:'shell'},{control:'http://example.com:9000',whep:'http://127.0.0.1:9001'},{whep:'http://127.0.0.1:9001'},{session:'bad'}])assert.throws(()=>read({...spec,...change}));
});
test('native view is an on demand view of the existing source graph',async()=>{
  const doc=readCanvas(new TextEncoder().encode(JSON.stringify({format:'alembic.canvas',version:1,title:'World',nodes:[{id:'master',path:spec.source,label:'Master',inputs:[]},{id:'native',path:'scenes/world/blender.stream',label:'Blender live',inputs:['master']}],views:['native'],defaultView:'native'})));
  const status=await canvasStatus(doc,async()=>'a'.repeat(64));
  assert.equal(status.native.state,'native');assert.equal(status.master.state,'source');
});

test('native descriptors support a bounded 120 fps configuration',()=>{
  assert.equal(readNativeStream(new TextEncoder().encode(JSON.stringify({...spec,fps:120}))).fps,120);
  assert.throws(()=>readNativeStream(new TextEncoder().encode(JSON.stringify({...spec,fps:121}))));
});
test('managed native-surface descriptors accept a same-origin lease endpoint without a WebRTC URL',()=>{
  const managed={...spec,transport:'native-surface',control:'/vms/shell-123/preview/lease-456',ticket:'t'.repeat(32),session:'a'.repeat(32)};
  assert.deepEqual(read(managed),managed);
  assert.throws(()=>read({...managed,control:'http://example.com/preview'}));
  assert.throws(()=>read({...managed,control:'http://127.0.0.1:42000',ticket:'short'}));
});
