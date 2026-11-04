// Node-local additions from the host's pinned Babylon 9.33.1 installation.
export { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js';
export { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
export { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
export { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
export { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
export { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';

import {VertexBuffer} from '@babylonjs/core/Buffers/buffer.js';
import '@babylonjs/core/Buffers/buffer.align.js';
// The host's lightweight WebGL binding does not import Babylon's WebGPU buffer
// extension. Apply the pinned extension to its shared buffers as well.
export function alignSharedBuffers(mesh){
 const shared=Object.getPrototypeOf(mesh.getVertexBuffer('position'));
 if('effectiveByteStride' in shared)return;
 for(const name of ['effectiveByteStride','effectiveByteOffset','effectiveBuffer','_rebuild','dispose','getWrapperBuffer','_alignBuffer']){
  Object.defineProperty(shared,name,Object.getOwnPropertyDescriptor(VertexBuffer.prototype,name));
 }
}
