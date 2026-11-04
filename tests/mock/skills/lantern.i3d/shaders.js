// Paired native shaders: no translation or CPU animation fallback.
export const glslVertex = `precision highp float;
attribute vec3 position; attribute vec3 normal;
uniform mat4 world,worldViewProjection; uniform float time,kind;
varying vec3 vPosition,vNormal,vLocal;
void main(){
 vec3 p=position;
 if(kind>0.5&&kind<1.5){
  float tip=smoothstep(-0.2,0.5,p.y);
  p.xz*=1.0-0.72*tip;
  p.x+=tip*tip*(0.13*sin(time*0.83)+0.06*sin(time*1.57));
  p.y*=1.0+0.045*sin(time*1.31);
 }
 vLocal=position; vPosition=(world*vec4(p,1.0)).xyz;
 vNormal=normalize(mat3(world)*normal);
 gl_Position=worldViewProjection*vec4(p,1.0);
}`;
export const glslFragment = `precision highp float;
varying vec3 vPosition,vNormal,vLocal;
uniform vec3 baseColor,eye; uniform float time,kind,metal;
float flicker(float t){return 0.90+0.065*sin(t*0.83)+0.035*sin(t*1.57+0.6)+0.015*sin(t*2.41);}
void main(){
 float f=flicker(time);
 vec3 n=normalize(vNormal),v=normalize(eye-vPosition);
 if(kind>1.5&&kind<2.5){
  float r=length(vLocal.xy*2.0);float a=exp(-r*r*5.5)*0.19*f*(1.0-smoothstep(0.65,1.0,r));
  gl_FragColor=vec4(1.0,0.39,0.075,a);return;
 }
 if(kind>0.5&&kind<1.5){
  float edge=pow(1.0-abs(dot(n,v)),1.4);
  vec3 c=mix(vec3(1.0,0.91,0.57),vec3(1.0,0.30,0.035),clamp(edge*0.8+(vLocal.y+0.5)*0.34,0.0,1.0));
  gl_FragColor=vec4(c*(0.94+0.06*f),1.0);return;
 }
 if(kind>2.5&&kind<3.5){
  float rim=pow(1.0-abs(dot(n,v)),4.0);
  gl_FragColor=vec4(0.38,0.58,0.63,0.018+0.12*rim);return;
 }
 vec3 delta=vec3(0.0,0.83,0.0)-vPosition;
 float d2=dot(delta,delta);vec3 l=normalize(delta);
 float lambert=max(0.0,dot(n,l));
 float key=max(0.0,dot(n,normalize(vec3(-1.3,2.6,1.0))));
 float grain=sin(vPosition.x*191.0+sin(vPosition.z*143.0))*sin(vPosition.y*207.0+vPosition.z*93.0);
 vec3 base=baseColor*(1.0+0.035*grain);
 float occlusion=1.0;
 if(kind>3.5){
  float r=length(vPosition.xz);
  occlusion=0.30+0.70*smoothstep(0.30,0.82,r);
 }
 vec3 c=base*(vec3(0.25,0.36,0.49)*(0.38+0.62*max(n.y,0.0))+vec3(0.52,0.64,0.78)*key*0.8);
 c+=base*vec3(1.0,0.39,0.085)*lambert*(1.5*f/(0.35+d2));
 float spec=pow(max(dot(n,normalize(l+v)),0.0),mix(20.0,70.0,metal));
 c+=mix(vec3(0.06),vec3(0.66,0.34,0.12),metal)*spec*1.4*f/(0.4+d2);
 float rim=pow(1.0-max(dot(n,v),0.0),3.0);
 c+=vec3(0.06,0.11,0.16)*rim*metal;
 c*=occlusion;
 c=vec3(1.0)-exp(-c*1.35);
 gl_FragColor=vec4(pow(c,vec3(0.454545)),1.0);
}`;
export const wgslVertex = `attribute position:vec3f; attribute normal:vec3f;
uniform world:mat4x4f; uniform worldViewProjection:mat4x4f;
uniform time:f32; uniform kind:f32;
varying vPosition:vec3f; varying vNormal:vec3f; varying vLocal:vec3f;
@vertex fn main(input:VertexInputs)->FragmentInputs {
 var p=vertexInputs.position;
 if(uniforms.kind>0.5&&uniforms.kind<1.5){
  let tip=smoothstep(-0.2,0.5,p.y);
  p.x*=1.0-0.72*tip;p.z*=1.0-0.72*tip;
  p.x+=tip*tip*(0.13*sin(uniforms.time*0.83)+0.06*sin(uniforms.time*1.57));
  p.y*=1.0+0.045*sin(uniforms.time*1.31);
 }
 vertexOutputs.vLocal=vertexInputs.position;
 vertexOutputs.vPosition=(uniforms.world*vec4f(p,1.0)).xyz;
 vertexOutputs.vNormal=normalize((uniforms.world*vec4f(vertexInputs.normal,0.0)).xyz);
 vertexOutputs.position=uniforms.worldViewProjection*vec4f(p,1.0);
}`;
export const wgslFragment = `varying vPosition:vec3f; varying vNormal:vec3f; varying vLocal:vec3f;
uniform baseColor:vec3f; uniform eye:vec3f; uniform time:f32; uniform kind:f32; uniform metal:f32;
fn flicker(t:f32)->f32{return 0.90+0.065*sin(t*0.83)+0.035*sin(t*1.57+0.6)+0.015*sin(t*2.41);}
@fragment fn main(input:FragmentInputs)->FragmentOutputs {
 let f=flicker(uniforms.time);
 let n=normalize(fragmentInputs.vNormal);let v=normalize(uniforms.eye-fragmentInputs.vPosition);
 if(uniforms.kind>1.5&&uniforms.kind<2.5){
  let r=length(fragmentInputs.vLocal.xy*2.0);
  let a=exp(-r*r*5.5)*0.19*f*(1.0-smoothstep(0.65,1.0,r));
  fragmentOutputs.color=vec4f(1.0,0.39,0.075,a);return fragmentOutputs;
 }
 if(uniforms.kind>0.5&&uniforms.kind<1.5){
  let edge=pow(1.0-abs(dot(n,v)),1.4);
  let c=mix(vec3f(1.0,0.91,0.57),vec3f(1.0,0.30,0.035),clamp(edge*0.8+(fragmentInputs.vLocal.y+0.5)*0.34,0.0,1.0));
  fragmentOutputs.color=vec4f(c*(0.94+0.06*f),1.0);return fragmentOutputs;
 }
 if(uniforms.kind>2.5&&uniforms.kind<3.5){
  let rim=pow(1.0-abs(dot(n,v)),4.0);
  fragmentOutputs.color=vec4f(0.38,0.58,0.63,0.018+0.12*rim);return fragmentOutputs;
 }
 let delta=vec3f(0.0,0.83,0.0)-fragmentInputs.vPosition;
 let d2=dot(delta,delta);let l=normalize(delta);
 let lambert=max(0.0,dot(n,l));
 let key=max(0.0,dot(n,normalize(vec3f(-1.3,2.6,1.0))));
 let grain=sin(fragmentInputs.vPosition.x*191.0+sin(fragmentInputs.vPosition.z*143.0))*sin(fragmentInputs.vPosition.y*207.0+fragmentInputs.vPosition.z*93.0);
 let base=uniforms.baseColor*(1.0+0.035*grain);
 var occlusion=1.0;
 if(uniforms.kind>3.5){let r=length(fragmentInputs.vPosition.xz);occlusion=0.30+0.70*smoothstep(0.30,0.82,r);}
 var c=base*(vec3f(0.25,0.36,0.49)*(0.38+0.62*max(n.y,0.0))+vec3f(0.52,0.64,0.78)*key*0.8);
 c+=base*vec3f(1.0,0.39,0.085)*lambert*(1.5*f/(0.35+d2));
 let spec=pow(max(dot(n,normalize(l+v)),0.0),mix(20.0,70.0,uniforms.metal));
 c+=mix(vec3f(0.06),vec3f(0.66,0.34,0.12),uniforms.metal)*spec*1.4*f/(0.4+d2);
 let rim=pow(1.0-max(dot(n,v),0.0),3.0);
 c+=vec3f(0.06,0.11,0.16)*rim*uniforms.metal;
 c*=occlusion;c=vec3f(1.0)-exp(-c*1.35);
 fragmentOutputs.color=vec4f(pow(c,vec3f(0.454545)),1.0);
}`;
