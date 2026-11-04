import{t as e}from"./shaderStore-D-XQlhUT.js";const t=`bonesDeclaration`,n=`#if NUM_BONE_INFLUENCERS>0
#ifndef USE_VERTEX_PULLING
attribute matricesIndices : vec4f;attribute matricesWeights : vec4f;
#if NUM_BONE_INFLUENCERS>4
attribute matricesIndicesExtra : vec4f;attribute matricesWeightsExtra : vec4f;
#endif
#endif
#ifndef BAKED_VERTEX_ANIMATION_TEXTURE
#ifdef BONETEXTURE
var boneSampler : texture_2d<f32>;uniform boneTextureInfo : vec2f;
#else
uniform mBones : array<mat4x4f,BonesPerMesh>;
#endif
#ifdef BONES_VELOCITY_ENABLED
uniform mPreviousBones : array<mat4x4f,BonesPerMesh>;
#endif
#ifdef BONETEXTURE
fn readMatrixFromRawSampler(smp : texture_2d<f32>,index : f32)->mat4x4f
{let offset=i32(index)*4; 
let textureWidth=i32(uniforms.boneTextureInfo.x);let y=offset/textureWidth;let x=offset % textureWidth;let m0=textureLoad(smp,vec2<i32>(x+0,y),0);let m1=textureLoad(smp,vec2<i32>(x+1,y),0);let m2=textureLoad(smp,vec2<i32>(x+2,y),0);let m3=textureLoad(smp,vec2<i32>(x+3,y),0);return mat4x4f(m0,m1,m2,m3);}
#endif
#endif
#endif
`;e.IncludesShadersStoreWGSL[t]||(e.IncludesShadersStoreWGSL[t]=n);const r={name:t,shader:n},i=`clipPlaneVertexDeclaration`,a=`#ifdef CLIPPLANE
uniform vClipPlane: vec4<f32>;varying fClipDistance: f32;
#endif
#ifdef CLIPPLANE2
uniform vClipPlane2: vec4<f32>;varying fClipDistance2: f32;
#endif
#ifdef CLIPPLANE3
uniform vClipPlane3: vec4<f32>;varying fClipDistance3: f32;
#endif
#ifdef CLIPPLANE4
uniform vClipPlane4: vec4<f32>;varying fClipDistance4: f32;
#endif
#ifdef CLIPPLANE5
uniform vClipPlane5: vec4<f32>;varying fClipDistance5: f32;
#endif
#ifdef CLIPPLANE6
uniform vClipPlane6: vec4<f32>;varying fClipDistance6: f32;
#endif
`;e.IncludesShadersStoreWGSL[i]||(e.IncludesShadersStoreWGSL[i]=a);const o={name:i,shader:a},s=`morphTargetsVertexGlobalDeclaration`,c=`#ifdef MORPHTARGETS
uniform morphTargetInfluences : array<f32,NUM_MORPH_INFLUENCERS>;
#ifdef MORPHTARGETS_TEXTURE 
uniform morphTargetTextureIndices : array<f32,NUM_MORPH_INFLUENCERS>;uniform morphTargetTextureInfo : vec3<f32>;var morphTargets : texture_2d_array<f32>;fn readVector3FromRawSampler(targetIndex : i32,vertexIndex : f32)->vec3<f32>
{ 
let textureWidth: i32=i32(uniforms.morphTargetTextureInfo.y);let y: i32=i32(vertexIndex)/textureWidth;let x: i32=i32(vertexIndex) % textureWidth;return textureLoad(morphTargets,vec2i(x,y),i32(uniforms.morphTargetTextureIndices[targetIndex]),0).xyz;}
fn readVector4FromRawSampler(targetIndex : i32,vertexIndex : f32)->vec4<f32>
{ 
let textureWidth: i32=i32(uniforms.morphTargetTextureInfo.y); 
let y: i32=i32(vertexIndex)/textureWidth;let x: i32=i32(vertexIndex) % textureWidth;return textureLoad(morphTargets,vec2i(x,y),i32(uniforms.morphTargetTextureIndices[targetIndex]),0);}
#endif
#endif
`;e.IncludesShadersStoreWGSL[s]||(e.IncludesShadersStoreWGSL[s]=c);const l={name:s,shader:c},u=`morphTargetsVertexDeclaration`,d=`#ifdef MORPHTARGETS
#ifndef MORPHTARGETS_TEXTURE
#ifdef MORPHTARGETS_POSITION
attribute position{X} : vec3<f32>;
#endif
#ifdef MORPHTARGETS_NORMAL
attribute normal{X} : vec3<f32>;
#endif
#ifdef MORPHTARGETS_TANGENT
attribute tangent{X} : vec3<f32>;
#endif
#ifdef MORPHTARGETS_UV
attribute uv_{X} : vec2<f32>;
#endif
#ifdef MORPHTARGETS_UV2
attribute uv2_{X} : vec2<f32>;
#endif
#ifdef MORPHTARGETS_COLOR
attribute color{X} : vec4<f32>;
#endif
#elif {X}==0
uniform morphTargetCount: f32;
#endif
#endif
`;e.IncludesShadersStoreWGSL[u]||(e.IncludesShadersStoreWGSL[u]=d);const f={name:u,shader:d},p=`morphTargetsVertexGlobal`,m=`#ifdef MORPHTARGETS
#ifdef MORPHTARGETS_TEXTURE
var vertexID : f32;
#endif
#endif
`;e.IncludesShadersStoreWGSL[p]||(e.IncludesShadersStoreWGSL[p]=m);const h={name:p,shader:m},g=`morphTargetsVertex`,_=`#ifdef MORPHTARGETS
#ifdef MORPHTARGETS_TEXTURE
#if {X}==0
for (var i=0; i<NUM_MORPH_INFLUENCERS; i=i+1) {if (f32(i)>=uniforms.morphTargetCount) {break;}
#ifdef USE_VERTEX_PULLING
vertexID=f32(vpVertexIndex)*uniforms.morphTargetTextureInfo.x;
#else
vertexID=f32(vertexInputs.vertexIndex)*uniforms.morphTargetTextureInfo.x;
#endif
#ifdef MORPHTARGETS_POSITION
#ifdef USE_VERTEX_PULLING
positionUpdated=positionUpdated+(readVector3FromRawSampler(i,vertexID)-vp_basePosition)*uniforms.morphTargetInfluences[i];
#else
positionUpdated=positionUpdated+(readVector3FromRawSampler(i,vertexID)-vertexInputs.position)*uniforms.morphTargetInfluences[i];
#endif
#endif
#ifdef MORPHTARGETTEXTURE_HASPOSITIONS
vertexID=vertexID+1.0;
#endif
#ifdef MORPHTARGETS_NORMAL
#ifdef USE_VERTEX_PULLING
normalUpdated=normalUpdated+(readVector3FromRawSampler(i,vertexID) -vp_baseNormal)*uniforms.morphTargetInfluences[i];
#else
normalUpdated=normalUpdated+(readVector3FromRawSampler(i,vertexID) -vertexInputs.normal)*uniforms.morphTargetInfluences[i];
#endif
#endif
#ifdef MORPHTARGETTEXTURE_HASNORMALS
vertexID=vertexID+1.0;
#endif
#ifdef MORPHTARGETS_UV
#ifdef USE_VERTEX_PULLING
uvUpdated=uvUpdated+(readVector3FromRawSampler(i,vertexID).xy-vp_baseUV)*uniforms.morphTargetInfluences[i];
#else
uvUpdated=uvUpdated+(readVector3FromRawSampler(i,vertexID).xy-vertexInputs.uv)*uniforms.morphTargetInfluences[i];
#endif
#endif
#ifdef MORPHTARGETTEXTURE_HASUVS
vertexID=vertexID+1.0;
#endif
#ifdef MORPHTARGETS_TANGENT
#ifdef USE_VERTEX_PULLING
tangentUpdated=vec4f(tangentUpdated.xyz+(readVector3FromRawSampler(i,vertexID) -vp_baseTangent.xyz)*uniforms.morphTargetInfluences[i],tangentUpdated.a);
#else
tangentUpdated=vec4f(tangentUpdated.xyz+(readVector3FromRawSampler(i,vertexID) -vertexInputs.tangent.xyz)*uniforms.morphTargetInfluences[i],tangentUpdated.a);
#endif
#endif
#ifdef MORPHTARGETTEXTURE_HASTANGENTS
vertexID=vertexID+1.0;
#endif
#ifdef MORPHTARGETS_UV2
#ifdef USE_VERTEX_PULLING
uv2Updated=uv2Updated+(readVector3FromRawSampler(i,vertexID).xy-vp_baseUV2)*uniforms.morphTargetInfluences[i];
#else
uv2Updated=uv2Updated+(readVector3FromRawSampler(i,vertexID).xy-vertexInputs.uv2)*uniforms.morphTargetInfluences[i];
#endif
#endif
#ifdef MORPHTARGETS_COLOR
#ifdef USE_VERTEX_PULLING
colorUpdated=colorUpdated+(readVector4FromRawSampler(i,vertexID)-vp_baseColor)*uniforms.morphTargetInfluences[i];
#else
colorUpdated=colorUpdated+(readVector4FromRawSampler(i,vertexID)-vertexInputs.color)*uniforms.morphTargetInfluences[i];
#endif
#endif
}
#endif
#else
#ifdef MORPHTARGETS_POSITION
#ifdef USE_VERTEX_PULLING
positionUpdated=positionUpdated+(vertexInputs.position{X}-vp_basePosition)*uniforms.morphTargetInfluences[{X}];
#else
positionUpdated=positionUpdated+(vertexInputs.position{X}-vertexInputs.position)*uniforms.morphTargetInfluences[{X}];
#endif
#endif
#ifdef MORPHTARGETS_NORMAL
#ifdef USE_VERTEX_PULLING
normalUpdated=normalUpdated+(vertexInputs.normal{X}-vp_baseNormal)*uniforms.morphTargetInfluences[{X}];
#else
normalUpdated=normalUpdated+(vertexInputs.normal{X}-vertexInputs.normal)*uniforms.morphTargetInfluences[{X}];
#endif
#endif
#ifdef MORPHTARGETS_TANGENT
#ifdef USE_VERTEX_PULLING
tangentUpdated=vec4f(tangentUpdated.xyz+(vertexInputs.tangent{X}-vp_baseTangent.xyz)*uniforms.morphTargetInfluences[{X}],tangentUpdated.a);
#else
tangentUpdated=vec4f(tangentUpdated.xyz+(vertexInputs.tangent{X}-vertexInputs.tangent.xyz)*uniforms.morphTargetInfluences[{X}],tangentUpdated.a);
#endif
#endif
#ifdef MORPHTARGETS_UV
#ifdef USE_VERTEX_PULLING
uvUpdated=uvUpdated+(vertexInputs.uv_{X}-vp_baseUV)*uniforms.morphTargetInfluences[{X}];
#else
uvUpdated=uvUpdated+(vertexInputs.uv_{X}-vertexInputs.uv)*uniforms.morphTargetInfluences[{X}];
#endif
#endif
#ifdef MORPHTARGETS_UV2
#ifdef USE_VERTEX_PULLING
uv2Updated=uv2Updated+(vertexInputs.uv2_{X}-vp_baseUV2)*uniforms.morphTargetInfluences[{X}];
#else
uv2Updated=uv2Updated+(vertexInputs.uv2_{X}-vertexInputs.uv2)*uniforms.morphTargetInfluences[{X}];
#endif
#endif
#ifdef MORPHTARGETS_COLOR
#ifdef USE_VERTEX_PULLING
colorUpdated=colorUpdated+(vertexInputs.color{X}-vp_baseColor)*uniforms.morphTargetInfluences[{X}];
#else
colorUpdated=colorUpdated+(vertexInputs.color{X}-vertexInputs.color)*uniforms.morphTargetInfluences[{X}];
#endif
#endif
#endif
#endif
`;e.IncludesShadersStoreWGSL[g]||(e.IncludesShadersStoreWGSL[g]=_);const v={name:g,shader:_},y=`bonesVertex`,b=`#ifndef BAKED_VERTEX_ANIMATION_TEXTURE
#if NUM_BONE_INFLUENCERS>0
var influence : mat4x4<f32>;
#ifdef BONETEXTURE
influence=readMatrixFromRawSampler(boneSampler,vertexInputs.matricesIndices[0])*vertexInputs.matricesWeights[0];
#if NUM_BONE_INFLUENCERS>1
influence=influence+readMatrixFromRawSampler(boneSampler,vertexInputs.matricesIndices[1])*vertexInputs.matricesWeights[1];
#endif 
#if NUM_BONE_INFLUENCERS>2
influence=influence+readMatrixFromRawSampler(boneSampler,vertexInputs.matricesIndices[2])*vertexInputs.matricesWeights[2];
#endif 
#if NUM_BONE_INFLUENCERS>3
influence=influence+readMatrixFromRawSampler(boneSampler,vertexInputs.matricesIndices[3])*vertexInputs.matricesWeights[3];
#endif 
#if NUM_BONE_INFLUENCERS>4
influence=influence+readMatrixFromRawSampler(boneSampler,vertexInputs.matricesIndicesExtra[0])*vertexInputs.matricesWeightsExtra[0];
#endif 
#if NUM_BONE_INFLUENCERS>5
influence=influence+readMatrixFromRawSampler(boneSampler,vertexInputs.matricesIndicesExtra[1])*vertexInputs.matricesWeightsExtra[1];
#endif 
#if NUM_BONE_INFLUENCERS>6
influence=influence+readMatrixFromRawSampler(boneSampler,vertexInputs.matricesIndicesExtra[2])*vertexInputs.matricesWeightsExtra[2];
#endif 
#if NUM_BONE_INFLUENCERS>7
influence=influence+readMatrixFromRawSampler(boneSampler,vertexInputs.matricesIndicesExtra[3])*vertexInputs.matricesWeightsExtra[3];
#endif 
#else 
influence=uniforms.mBones[i32(vertexInputs.matricesIndices[0])]*vertexInputs.matricesWeights[0];
#if NUM_BONE_INFLUENCERS>1
influence=influence+uniforms.mBones[i32(vertexInputs.matricesIndices[1])]*vertexInputs.matricesWeights[1];
#endif 
#if NUM_BONE_INFLUENCERS>2
influence=influence+uniforms.mBones[i32(vertexInputs.matricesIndices[2])]*vertexInputs.matricesWeights[2];
#endif 
#if NUM_BONE_INFLUENCERS>3
influence=influence+uniforms.mBones[i32(vertexInputs.matricesIndices[3])]*vertexInputs.matricesWeights[3];
#endif 
#if NUM_BONE_INFLUENCERS>4
influence=influence+uniforms.mBones[i32(vertexInputs.matricesIndicesExtra[0])]*vertexInputs.matricesWeightsExtra[0];
#endif 
#if NUM_BONE_INFLUENCERS>5
influence=influence+uniforms.mBones[i32(vertexInputs.matricesIndicesExtra[1])]*vertexInputs.matricesWeightsExtra[1];
#endif 
#if NUM_BONE_INFLUENCERS>6
influence=influence+uniforms.mBones[i32(vertexInputs.matricesIndicesExtra[2])]*vertexInputs.matricesWeightsExtra[2];
#endif 
#if NUM_BONE_INFLUENCERS>7
influence=influence+uniforms.mBones[i32(vertexInputs.matricesIndicesExtra[3])]*vertexInputs.matricesWeightsExtra[3];
#endif 
#endif
finalWorld=finalWorld*influence;
#endif
#endif
`;e.IncludesShadersStoreWGSL[y]||(e.IncludesShadersStoreWGSL[y]=b);const x={name:y,shader:b},S=`clipPlaneVertex`,C=`#ifdef CLIPPLANE
vertexOutputs.fClipDistance=dot(worldPos,uniforms.vClipPlane);
#endif
#ifdef CLIPPLANE2
vertexOutputs.fClipDistance2=dot(worldPos,uniforms.vClipPlane2);
#endif
#ifdef CLIPPLANE3
vertexOutputs.fClipDistance3=dot(worldPos,uniforms.vClipPlane3);
#endif
#ifdef CLIPPLANE4
vertexOutputs.fClipDistance4=dot(worldPos,uniforms.vClipPlane4);
#endif
#ifdef CLIPPLANE5
vertexOutputs.fClipDistance5=dot(worldPos,uniforms.vClipPlane5);
#endif
#ifdef CLIPPLANE6
vertexOutputs.fClipDistance6=dot(worldPos,uniforms.vClipPlane6);
#endif
`;e.IncludesShadersStoreWGSL[S]||(e.IncludesShadersStoreWGSL[S]=C);const w={name:S,shader:C};export{f as a,r as c,h as i,x as n,l as o,v as r,o as s,w as t};