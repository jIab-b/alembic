// A small shared expression body emits native GLSL and WGSL. WebGPU does not
// fetch a shader translator, and both GPU paths use the same authored equations.
const body = `
vec3 n = normalize(vNormal);
vec3 view = normalize(eye-vPosition);
vec2 atlasUV = vec2(vUV.x,1.0-vUV.y);
vec3 base = COLOR_SAMPLE;
float mask = MASK_SAMPLE;
float alpha = 1.0;
vec3 color = vec3(0.0);
if(kind<2.5){
 float key = max(0.0,dot(n,normalize(vec3(-0.7,1.4,1.0))));
 float fill = max(0.0,dot(n,normalize(vec3(1.0,0.4,-0.5))));
 float rim = pow(1.0-abs(dot(n,view)),3.0);
 float heightAO = 0.65+0.35*smoothstep(0.0,1.8,vPosition.y);
 color = base*(vec3(0.27,0.34,0.48)+vec3(0.83,0.91,1.0)*key+vec3(0.48,0.25,0.62)*fill)*heightAO;
 float spec = pow(max(0.0,dot(n,normalize(view+normalize(vec3(-0.7,1.4,1.0))))),40.0);
 if(kind>0.5){color+=vec3(0.55,0.38,0.15)*spec*0.7;}
 vec3 toGate = vec3(0.0,3.25,0.0)-vPosition;
 float light = max(dot(n,normalize(toGate)),0.0)*power/(0.6+dot(toGate,toGate)*0.16);
 color+=base*vec3(0.52,0.18,0.86)*light;
 if(kind<0.5){
  float pulse = 0.88+0.12*sin(time*2.5+vPosition.y*2.8);
  color+=mask*charge*vec3(0.12,1.4,1.7)*pulse;
 }
 if(kind>1.5){
  color=vec3(0.055,0.39,0.46)*(0.6+key)+vec3(0.1,0.8,0.92)*(0.2+0.8*charge)*(0.28+rim*0.8)+vec3(0.7,1.0,1.0)*spec;
 }
}else{
 vec2 p = vUV*2.0-vec2(1.0);
 float r = length(p);
 float angle = ATAN(p.y,p.x);
 if(kind<3.5){
  float opening = 0.03+0.97*power;
  float edge = 1.0-smoothstep(opening-0.025,opening+0.005,r);
  float rad = r/max(opening,0.025);
  float wave = sin(p.x*15.0+sin(p.y*11.0-time*1.8))+sin(p.y*17.0+cos(p.x*8.0+time*1.6));
  float spiral = angle+log(rad+0.055)*2.5-time*2.1;
  float cloud = 0.5+0.5*sin(spiral*3.0+wave*0.75-rad*6.0);
  float thread = pow(0.5+0.5*sin(spiral*7.0+wave*0.55),16.0);
  float lace = pow(0.5+0.5*sin(spiral*13.0-rad*24.0+wave),26.0);
  float band = exp(-pow((rad-0.93)*38.0,2.0));
  float pupil = smoothstep(0.045,0.25,rad);
  vec3 nebula = mix(vec3(0.15,0.012,0.29),vec3(0.36,0.055,0.65),cloud);
  nebula+=vec3(0.64,0.24,1.0)*thread*(0.3+0.7*rad);
  nebula+=vec3(0.70,0.17,0.82)*lace*0.45;
  nebula*=pupil;
  nebula+=vec3(0.74,0.40,1.0)*band*(0.8+0.2*sin(angle*15.0+time*6.0));
  float stars = pow(max(0.0,sin(p.x*174.3+p.y*23.7)*sin(p.y*153.7-p.x*41.3)),90.0);
  nebula+=vec3(0.85,0.62,1.0)*stars*pupil;
  color=nebula*(0.2+0.8*power);alpha=edge*(0.2+0.8*power);
 }else if(kind<4.5){
  float ring = exp(-pow((r-0.77)*10.0,2.0));
  color=vec3(0.54,0.14,0.95);alpha=ring*power*0.20;
 }else if(kind<5.5){
  color=vec3(0.25,0.85,1.0);alpha=exp(-r*r*8.0)*(1.0-smoothstep(0.2,1.0,r))*charge*0.7;
 }else{
  float core = exp(-r*r*16.0);
  float flare = exp(-abs(p.x)*20.0-abs(p.y)*3.5);
  color=mix(vec3(0.65,0.16,1.0),vec3(1.0,0.86,1.0),core);
  alpha=(exp(-r*r*5.0)*0.65+flare*0.65)*(1.0-smoothstep(0.55,1.0,r))*charge;
 }
}
OUTPUT = vec4(color,alpha);
`;

export const glslVertex=`precision highp float;
attribute vec3 position;attribute vec3 normal;attribute vec2 uv;
uniform mat4 world,worldViewProjection;
varying vec3 vPosition,vNormal;varying vec2 vUV;
void main(){vPosition=(world*vec4(position,1.0)).xyz;vNormal=normalize(mat3(world)*normal);vUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}`;
export const glslFragment=`precision highp float;
varying vec3 vPosition,vNormal;varying vec2 vUV;
uniform vec3 eye;uniform float time,kind,power,charge;
uniform sampler2D colorAtlas,emissionAtlas;
void main(){${body.replace('COLOR_SAMPLE','texture2D(colorAtlas,atlasUV).rgb').replace('MASK_SAMPLE','texture2D(emissionAtlas,atlasUV).r').replaceAll('ATAN','atan').replace('OUTPUT','gl_FragColor')}}`;
export const wgslVertex=`attribute position:vec3f;attribute normal:vec3f;attribute uv:vec2f;
uniform world:mat4x4f;uniform worldViewProjection:mat4x4f;
varying vPosition:vec3f;varying vNormal:vec3f;varying vUV:vec2f;
@vertex fn main(input:VertexInputs)->FragmentInputs{
vertexOutputs.vPosition=(uniforms.world*vec4f(vertexInputs.position,1.0)).xyz;
vertexOutputs.vNormal=normalize((uniforms.world*vec4f(vertexInputs.normal,0.0)).xyz);
vertexOutputs.vUV=vertexInputs.uv;vertexOutputs.position=uniforms.worldViewProjection*vec4f(vertexInputs.position,1.0);
}`;
const types={float:'f32',vec2:'vec2f',vec3:'vec3f',vec4:'vec4f'};
const wgslBody=body.replace('COLOR_SAMPLE','textureSample(colorAtlas,colorAtlasSampler,atlasUV).rgb')
 .replace('MASK_SAMPLE','textureSample(emissionAtlas,emissionAtlasSampler,atlasUV).r')
 .replace(/\b(float|vec[234]) (\w+)\s*=/g,(_,t,n)=>`var ${n}:${types[t]} =`)
 .replace(/\bvec([234])\(/g,'vec$1f(')
 .replace(/\b(eye|time|kind|power|charge)\b/g,'uniforms.$1')
 .replace(/\b(vPosition|vNormal|vUV)\b/g,'fragmentInputs.$1')
 .replaceAll('ATAN','atan2').replace('OUTPUT','fragmentOutputs.color');
export const wgslFragment=`varying vPosition:vec3f;varying vNormal:vec3f;varying vUV:vec2f;
uniform eye:vec3f;uniform time:f32;uniform kind:f32;uniform power:f32;uniform charge:f32;
var colorAtlasSampler:sampler;var colorAtlas:texture_2d<f32>;
var emissionAtlasSampler:sampler;var emissionAtlas:texture_2d<f32>;
@fragment fn main(input:FragmentInputs)->FragmentOutputs{${wgslBody}return fragmentOutputs;}`;
