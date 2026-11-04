// Small node-local extensions to the host's pinned Babylon runtime.
export {WebGPUEngine} from '@babylonjs/core/Engines/webgpuEngine.js';
export {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial.js';
export {Color3} from '@babylonjs/core/Maths/math.color.js';
export {Quaternion} from '@babylonjs/core/Maths/math.vector.js';
export {TransformNode} from '@babylonjs/core/Meshes/transformNode.js';
export {Mesh} from '@babylonjs/core/Meshes/mesh.js';
export {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData.js';
export {CreateSphere} from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
export {CreateCylinder} from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
export {DirectionalLight} from '@babylonjs/core/Lights/directionalLight.js';
export {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer.js';
import '@babylonjs/core/Buffers/buffer.align.js';
export function alignSharedBuffers(mesh){
 const shared=Object.getPrototypeOf(mesh.getVertexBuffer('position'));
 if('effectiveByteStride' in shared)return;
 for(const name of ['effectiveByteStride','effectiveByteOffset','effectiveBuffer','_rebuild','dispose','getWrapperBuffer','_alignBuffer'])Object.defineProperty(shared,name,Object.getOwnPropertyDescriptor(VertexBuffer.prototype,name));
}

// The shared WebGL Engine owns its own Effect registry. Populate it with the
// same pinned shader sources as these local materials before compilation.
import {Effect} from '@babylonjs/core/Materials/effect.js';
import {ThinEngine} from '@babylonjs/core/Engines/thinEngine.js';
import '@babylonjs/core/Engines/Extensions/engine.renderTargetTexture.js';
import '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import {ShaderStore} from '@babylonjs/core/Engines/shaderStore.js';
import '@babylonjs/core/Shaders/default.vertex.js';
import '@babylonjs/core/Shaders/default.fragment.js';
import '@babylonjs/core/Shaders/shadowMap.vertex.js';
import '@babylonjs/core/Shaders/shadowMap.fragment.js';
export function registerSharedShaders(engine){
 const effect=engine.createEffect({vertexSource:'attribute vec3 position; void main(){gl_Position=vec4(position,1.0);}',fragmentSource:'precision highp float; void main(){gl_FragColor=vec4(1.0);}'},{attributes:['position'],uniformsNames:[],samplers:[],defines:''});
 effect.constructor.prototype.setDepthStencilTexture=Effect.prototype.setDepthStencilTexture;
 engine.setDepthStencilTexture=ThinEngine.prototype.setDepthStencilTexture;
 Object.assign(effect.constructor.ShadersStore,ShaderStore.ShadersStore);
 Object.assign(effect.constructor.IncludesShadersStore,ShaderStore.IncludesShadersStore);
 effect.dispose();
}
