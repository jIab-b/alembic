import test from 'node:test';
import assert from 'node:assert/strict';
import {container, pack} from '../render/babylon/document.js';
import {editSolid, readSolids} from '../render/babylon/solids.js';

const doc = () => ({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Original',mesh:0}],
  meshes:[{primitives:[]}],buffers:[{byteLength:4}],bufferViews:[{buffer:0,byteOffset:0,byteLength:4}],
  accessors:[],animations:[{name:'Retained motion',channels:[],samplers:[]}],
  extensions:{CUSTOM_source:{keep:true}},extensionsUsed:['CUSTOM_source']});
const shape = kind => ({shape:kind,center:[2,3,4],...(kind==='sphere'?{radius:2,radii:[1,2,3]}:{size:[2,4,6]})});

test('real GLB solids preserve source content, append mesh geometry and retain stable node indices on edits',()=>{
  const original=doc(),bin=new Uint8Array([19,27,33,45]),source=pack(original,bin);
  const created=editSolid(source,'model.glb','owned-one',shape('box'));
  const {json,bin:bytes}=container(created);
  assert.deepEqual(json.nodes[0],original.nodes[0]);assert.deepEqual(json.animations,original.animations);
  assert.deepEqual(json.extensions,original.extensions);assert.deepEqual(json.extensionsUsed,original.extensionsUsed);
  assert.deepEqual([...bytes.subarray(0,4)],[...bin]);assert.equal(json.nodes.length,2);
  assert.equal(json.nodes[1].extras.alembicSolid.id,'owned-one');assert.equal(json.meshes[1].primitives[0].attributes.POSITION,0);
  assert.equal(json.materials[0].pbrMetallicRoughness.baseColorFactor[3],1);assert.equal(json.materials[0].alphaMode,undefined);
  const resized=editSolid(created,'model.glb','owned-one',{...shape('box'),center:[9,8,7],size:[3,5,7]});
  const next=container(resized);assert.equal(next.json.nodes.length,2);assert.equal(next.json.meshes.length,2);
  assert.deepEqual(next.json.nodes[1].translation,[9,8,7]);assert.deepEqual(next.json.nodes[1].scale,[3,5,7]);
  assert.deepEqual(next.bin,bytes);assert.equal(readSolids(resized).length,1);
  const removed=container(editSolid(resized,'model.glb','owned-one',null));
  assert.deepEqual(removed.json.scenes[0].nodes,[0]);assert.equal(removed.json.nodes.length,2);
  assert.deepEqual(removed.json.nodes[0],original.nodes[0]);assert.equal(removed.json.nodes[1].mesh,undefined);
  assert.deepEqual(readSolids(editSolid(resized,'model.glb','owned-one',null)),[]);
});

test('JSON glTF retains external and data-URI resources while adding an independent embedded buffer',()=>{
  const original=doc();original.buffers=[{byteLength:16,uri:'assets/original.bin'},{byteLength:4,uri:'data:application/octet-stream;base64,AQIDBA=='}];
  original.images=[{uri:'textures/stone.png'}];
  const source=new TextEncoder().encode(JSON.stringify(original));
  const result=container(editSolid(source,'model.gltf','sphere-1',shape('sphere'))).json;
  assert.deepEqual(result.buffers.slice(0,2),original.buffers);assert.deepEqual(result.images,original.images);
  assert.match(result.buffers[2].uri,/^data:application\/octet-stream;base64,/);
  assert.equal(result.bufferViews.at(-1).buffer,2);assert.deepEqual(result.nodes[1].scale,[1,2,3]);
  assert.equal(readSolids(new TextEncoder().encode(JSON.stringify(result)))[0].solidId,'sphere-1');
});

test('every added box and sphere triangle faces outward with aligned geometry accessors',()=>{
  for(const kind of ['box','sphere']){
    const result=container(editSolid(pack(doc(),new Uint8Array(4)),'model.glb',kind,shape(kind)));
    const mesh=result.json.meshes.at(-1),primitive=mesh.primitives[0];
    const attribute=result.json.accessors[primitive.attributes.POSITION],index=result.json.accessors[primitive.indices];
    const positionView=result.json.bufferViews[attribute.bufferView],indexView=result.json.bufferViews[index.bufferView];
    assert.equal(positionView.byteOffset%4,0);assert.equal(indexView.byteOffset%4,0);
    const data=new DataView(result.bin.buffer,result.bin.byteOffset,result.bin.byteLength);
    const vertex=i=>[0,1,2].map(k=>data.getFloat32(positionView.byteOffset+(i*3+k)*4,true));
    for(let i=0;i<index.count;i+=3){
      const [a,b,c]=[0,1,2].map(k=>vertex(data.getUint16(indexView.byteOffset+(i+k)*2,true)));
      const u=b.map((n,k)=>n-a[k]),v=c.map((n,k)=>n-a[k]);
      const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      assert.ok(cross.reduce((sum,n,k)=>sum+n*(a[k]+b[k]+c[k]),0)>0,kind+' triangle '+i/3+' faces outward');
    }
  }
});

test('unknown GLB chunks survive source edits byte for byte',()=>{
  const base=pack(doc(),new Uint8Array(4)),chunk=new Uint8Array(16),view=new DataView(chunk.buffer);
  view.setUint32(0,8,true);view.setUint32(4,0x43555354,true);chunk.set([11,22,33,44,55,66,77,88],8);
  const source=new Uint8Array(base.length+chunk.length);source.set(base);source.set(chunk,base.length);new DataView(source.buffer).setUint32(8,source.length,true);
  const output=editSolid(source,'model.glb','one',shape('box'));
  assert.deepEqual(output.subarray(-16),chunk);assert.equal(new DataView(output.buffer).getUint32(8,true),output.length);
});

test('non-3D shapes and invalid solid dimensions are rejected without changing input bytes',()=>{
  const source=pack(doc(),new Uint8Array(4)),copy=source.slice();
  for(const item of [{shape:'area',center:[0,0,0]}, {...shape('box'),size:[1,0,2]}, {...shape('sphere'),center:[NaN,0,0]}])
    assert.throws(()=>editSolid(source,'model.glb','one',item));
  assert.throws(()=>editSolid(source,'image.svg','one',shape('box')),/GLB or glTF/);
  assert.deepEqual(source,copy);
});
