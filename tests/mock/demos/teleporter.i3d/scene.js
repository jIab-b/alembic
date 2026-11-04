import {Engine,Scene,ArcRotateCamera,Vector3,CreateBox,bindRender} from '/assets/play/renderer.js';
import {WebGPUEngine,ShaderMaterial,Mesh,VertexData,Texture,CreatePlane,alignSharedBuffers} from './assets/runtime.min.js';
import {glslVertex,glslFragment,wgslVertex,wgslFragment} from './shaders.js';

const canvas=document.querySelector('canvas');
const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
const webgpu=!!adapter;
const engine=webgpu?new WebGPUEngine(canvas,{antialias:true,powerPreference:'high-performance'}):new Engine(canvas,true,{disableWebGL1Support:true,failIfMajorPerformanceCaveat:true,preserveDrawingBuffer:true});
if(webgpu)await engine.initAsync();
engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio,1.5));
const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor.set(.028,.043,.075,1);
const camera=new ArcRotateCamera('Aether Gate inspection',0,1,12,new Vector3(0,2.6,0),scene);
camera.setPosition(new Vector3(7.5,6.4,13.8));camera.fov=.57;camera.minZ=.05;camera.maxZ=100;
const probe=CreateBox('buffer bootstrap',{size:.001},scene);alignSharedBuffers(probe);probe.dispose();
const colorAtlas=new Texture('./assets/stone-runes.png',scene,false,false);
const emissionAtlas=new Texture('./assets/rune-emission.png',scene,false,false);
colorAtlas.anisotropicFilteringLevel=8;emissionAtlas.anisotropicFilteringLevel=8;
const materials=[],runes=[],crystals=[];
function material(name,kind,charge=1){
 const m=new ShaderMaterial(name,scene,{vertexSource:webgpu?wgslVertex:glslVertex,fragmentSource:webgpu?wgslFragment:glslFragment},{attributes:['position','normal','uv'],uniforms:['world','worldViewProjection','eye','time','kind','power','charge'],samplers:['colorAtlas','emissionAtlas'],shaderLanguage:webgpu?1:0,needAlphaBlending:kind>=3});
 m.setTexture('colorAtlas',colorAtlas);m.setTexture('emissionAtlas',emissionAtlas);
 m.setFloat('kind',kind);m.setFloat('time',0);m.setFloat('power',1);m.setFloat('charge',charge);m.setVector3('eye',camera.position);
 m.onError=(_,error)=>{throw Error('Aether Gate shader failed: '+error)};
 if(kind>=3){m.backFaceCulling=false;m.disableDepthWrite=true;}
 materials.push(m);return m;
}
const stone=material('Painted basalt • UV atlas',0,.3),gold=material('Weathered brass',1),crystal=material('Aether crystal shader',2);
const response=await fetch('./assets/geometry.json');if(!response.ok)throw Error('Model geometry missing');
for(const row of await response.json()){
 const mesh=new Mesh(row.name,scene),data=new VertexData();
 // Blender's outward triangles are counterclockwise in this right-handed frame.
 mesh.sideOrientation=1;
 for(const key of ['positions','normals','uvs','indices'])data[key]=row[key];data.applyToMesh(mesh);
 if(row.rune>=0){mesh.material=material('Runic ignition '+row.rune,0);runes.push({index:row.rune,material:mesh.material});}
 else mesh.material=row.kind==='gold'?gold:row.kind==='crystal'?crystal:stone;
}
const portalMaterial=material('Logarithmic aether vortex',3);
const portal=CreatePlane('Swirling portal membrane',{size:3.97,sideOrientation:2},scene);portal.position.set(0,3.25,.02);portal.material=portalMaterial;portal.alphaIndex=1;
const aura=CreatePlane('Soft portal radiance',{size:5.15,sideOrientation:2},scene);aura.position.set(0,3.25,-.06);aura.material=material('Portal radiance',4);aura.isPickable=false;aura.alphaIndex=0;
const moteMaterial=material('Aether motes',5);
const motes=[];
for(let i=0;i<48;i++){
 const m=CreatePlane('Orbiting aether mote '+i,{size:.025+(i%5)*.009},scene);m.material=moteMaterial;m.billboardMode=7;m.isPickable=false;m.alphaIndex=3;motes.push(m);
}
const sparkMaterial=material('Violet discharge sparks',6);
const sparks=[];
for(let i=0;i<72;i++){
 const m=CreatePlane('Violet spark '+i,{size:1},scene);
 m.material=sparkMaterial;m.isPickable=false;m.alphaIndex=4;sparks.push(m);
}
for(const x of [-2.75,2.75]){
 const m=CreatePlane('Crystal radiance',{size:1.12},scene);m.position.set(x,3.17,-.05);m.material=material('Crystal halo',5,.55);m.billboardMode=7;m.isPickable=false;m.alphaIndex=2;crystals.push(m.material);
}
let started=null,time=0,power=1,frames=0;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};
function update(t,playing){
 time=t;power=playing?smooth(2.8,8.8,t):1;
 for(const m of materials){m.setFloat('time',t);m.setFloat('power',power);m.setVector3('eye',camera.position);}
 for(const r of runes){const c=playing?smooth(.35+r.index*.13,1.1+r.index*.13,t):1;r.material.setFloat('charge',c);}
 crystal.setFloat('charge',playing?smooth(0,3,t):1);
 for(const c of crystals)c.setFloat('charge',playing?smooth(0,3,t)*.55:.55);
 moteMaterial.setFloat('charge',power);
 sparkMaterial.setFloat('charge',smooth(.12,.55,power));
 // Deterministic short-lived spiral streaks: the same time reproduces the same
 // burst, so the host's playback reset restores the authored inspection pose.
 for(let i=0;i<sparks.length;i++){
  const life=(t*(.68+(i%5)*.09)+i*.618034)%1;
  const envelope=Math.sin(Math.PI*life);
  const a=i*2.39996+t*(1.65+(i%4)*.21)+life*.62;
  const r=(.75+life*1.5)*(.12+.88*power);
  const s=.65+(i%7)*.09;
  sparks[i].position.set(Math.sin(a)*r,3.25+Math.cos(a)*r,.56+life*.42);
  sparks[i].rotation.z=-a-Math.PI/2;
  sparks[i].scaling.set(.055*s*envelope,(.15+life*.16)*s*envelope,1);
 }
 for(let i=0;i<motes.length;i++){
  const a=i*2.39996+t*(.13+(i%4)*.06),r=1.95+(i%7)*.067;
  motes[i].position.set(Math.sin(a)*r,3.25+Math.cos(a)*r,.40+Math.sin(a*2+i)*.32);
 }
}
update(0,false);
const binding=await bindRender({scene,camera,interaction:{io_lock(){},release(){}},
 play(script){const config=JSON.parse(script);if(config.effect!=='power-up')throw Error('Unknown teleporter effect');started=performance.now();update(0,true);},
 reset(){started=null;update(0,false);}});
await scene.whenReadyAsync();
await Promise.all(materials.map(m=>m.forceCompilationAsync(scene.meshes.find(mesh=>mesh.material===m))));
engine.runRenderLoop(()=>{update(started===null?0:(performance.now()-started)/1000,started!==null);scene.render();frames++;});
window.teleporter={scene,camera,binding,portal,runes,sparks,materials,get time(){return time},get power(){return power},get frames(){return frames},get playing(){return started!==null},backend:webgpu?'WebGPU':'WebGL2'};
addEventListener('pagehide',()=>{engine.stopRenderLoop();binding.dispose();scene.dispose();engine.dispose();},{once:true});
