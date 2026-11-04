import{t as e}from"./shaderStore-D-XQlhUT.js";import{t}from"./helperFunctions-BQ_cyaz2.js";const n=`rgbdDecodePixelShader`;e.ShadersStore[n]||(e.ShadersStore[n]=`varying vec2 vUV;uniform sampler2D textureSampler;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) 
{gl_FragColor=vec4(fromRGBD(texture2D(textureSampler,vUV)),1.0);}`);const r=[t];for(let t of r)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);