import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {PerspectiveCamera}=require('three');
import {NativeCamera} from '../frontend/src/native-camera.js';
function setup(){
 const camera=new PerspectiveCamera(60,1.6,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const state={clip:new (require('three').Matrix4)().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).toArray(),view:camera.matrixWorldInverse.toArray(),world:camera.matrixWorld.toArray(),windowY:camera.projectionMatrix.elements[5],orthographic:false,distance:5,region:[0,0,1280,800],width:1280,height:800,sourceRevision:'a'.repeat(64)};
 const requests=[],captures=[],native=new NativeCamera(async request=>{requests.push(request);return {camera:state,point:[0,0,0],objects:[{id:'blender:column',name:'column'}],context:{source:'/workspace/master.blend'}}},()=>({left:100,top:50,width:1000,height:1000}),async area=>{captures.push(area);return new Uint8Array([1])},'master.blend');native.update(state);return {native,requests,captures,state};
}
test('native camera respects source regions, letterboxing and world-unit handle drags',()=>{
 const {native}=setup();assert.deepEqual(native.project([0,0,0]),[500,500]);assert.equal(native.project([0,0,6]),null);
 const frame=native.dragFrame([0,0,0]);assert.ok(Math.abs(native.project([100*frame.scale,0,0])[0]-600)<1e-8);assert.deepEqual(native.clientPoint([640,400]),[600,550]);
});
test('native picking and prompt context use the real camera and native object ids',async()=>{
 const {native,requests}=setup();await native.locate(600,550);assert.deepEqual(requests[0].point,[640,400]);assert.equal(requests[0].camera.sourceRevision,'a'.repeat(64));
 const result=await native.resolve({shape:'sphere',center:[0,0,0],radius:1});assert.equal(result.objects[0].id,'blender:column');assert.equal(result.context.source,'master.blend');
});
test('native crops are projected from world bounds and preserve camera state',async()=>{
 const {native,captures,state}=setup(),before=JSON.stringify(state);await native.crop({shape:'sphere',center:[0,0,0],radius:.5});assert.equal(JSON.stringify(native.state),before);assert.ok(captures[0].every(v=>v>=0&&v<=1));assert.ok(captures[0][2]>0&&captures[0][3]>0);
});
