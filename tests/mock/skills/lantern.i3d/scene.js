import {Engine,Scene,ArcRotateCamera,Vector3,CreateBox,bindRender} from '/assets/play/renderer.js';
import {WebGPUEngine,ShaderMaterial,alignSharedBuffers,CreateCylinder,CreateSphere,CreateTorus,CreatePlane} from './runtime.min.js';
import {glslVertex,glslFragment,wgslVertex,wgslFragment} from './shaders.js';

const canvas=document.querySelector('canvas');
const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
const webgpu=!!adapter;
const engine=webgpu?new WebGPUEngine(canvas,{antialias:true,powerPreference:'high-performance'}):new Engine(canvas,true,{disableWebGL1Support:true,failIfMajorPerformanceCaveat:true,preserveDrawingBuffer:true});
if(webgpu)await engine.initAsync();
engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio,2));
const scene=new Scene(engine);scene.useRightHandedSystem=true;
scene.clearColor.set(0.043,0.065,0.086,1);
const camera=new ArcRotateCamera('Lantern inspection',0.9,1.25,6,new Vector3(0,0.85,0),scene);
camera.setPosition(new Vector3(3.6,2.65,4.8));camera.fov=0.56;camera.minZ=0.02;camera.maxZ=60;
const bufferProbe=CreateBox('buffer extension bootstrap',{size:0.001},scene);alignSharedBuffers(bufferProbe);bufferProbe.dispose();
const materials=[];
function material(name,color,kind=0,metal=0){
 const m=new ShaderMaterial(name,scene,{vertexSource:webgpu?wgslVertex:glslVertex,fragmentSource:webgpu?wgslFragment:glslFragment},{attributes:['position','normal'],uniforms:['world','worldViewProjection','time','kind','metal','baseColor','eye'],shaderLanguage:webgpu?1:0,needAlphaBlending:kind===2||kind===3});
 m.setVector3('baseColor',new Vector3(...color));m.setFloat('kind',kind);m.setFloat('metal',metal);m.setFloat('time',0);m.setVector3('eye',camera.position);
 m.onError=(_,error)=>{throw Error('Lantern shader compilation failed: '+error)};
 if(kind===2||kind===3){m.backFaceCulling=false;m.disableDepthWrite=true;}
 if(kind===2)m.alphaMode=1;
 materials.push(m);return m;
}
const bronze=material('Patinated bronze',[0.115,0.071,0.036],0,0.86);
const edge=material('Worn brass edges',[0.34,0.19,0.062],0,0.92);
const dark=material('Blackened metal',[0.029,0.036,0.038],0,0.7);
const stone=material('Blue basalt',[0.09,0.115,0.13],4,0);
const pebble=material('Slate pebbles',[0.075,0.095,0.11],0,0);
const wax=material('Warm ivory wax',[0.72,0.54,0.28],0,0);
const fire=material('Slow flicker flame',[1,0.6,0.1],1);
const halo=material('Soft amber glow',[1,0.4,0.1],2);
const glass=material('Clear glass',[0.4,0.5,0.6],3);
function place(mesh,mat,x,y,z){mesh.material=mat;mesh.position.set(x,y,z);return mesh;}
function box(name,w,h,d,x,y,z,mat=bronze){return place(CreateBox(name,{width:w,height:h,depth:d},scene),mat,x,y,z);}
function cylinder(name,diameter,height,y,mat,top=diameter,sides=64,x=0,z=0){return place(CreateCylinder(name,{diameterBottom:diameter,diameterTop:top,height,tessellation:sides},scene),mat,x,y,z);}

// A small, self-contained still life. No textures or external scene assets.
cylinder('Round basalt footing',2.55,0.13,0.015,stone,2.48,64);
cylinder('Lower basalt bevel',2.42,0.035,-0.06,dark,2.55,64);
box('Lantern foot',0.79,0.07,0.79,0,0.14,0,dark);
box('Lower brass lip',0.77,0.025,0.77,0,0.187,0,edge);
box('Stepped lantern base',0.69,0.12,0.69,0,0.255,0,bronze);
box('Base rim',0.76,0.038,0.76,0,0.326,0,edge);
box('Inner hearth',0.61,0.025,0.61,0,0.356,0,dark);
for(const x of [-0.315,0.315])for(const z of [-0.315,0.315]){
 box('Bronze corner upright',0.041,0.83,0.041,x,0.776,z,bronze);
 box('Upright brass foot',0.054,0.055,0.054,x,0.39,z,edge);
 box('Upright brass crown',0.054,0.055,0.054,x,1.155,z,edge);
}
for(const z of [-0.316,0.316]){
 box('Window lower rail',0.63,0.019,0.024,0,0.42,z,bronze);
 const panel=box('Clear glass pane',0.58,0.70,0.001,0,0.775,z,glass);panel.isPickable=false;panel.alphaIndex=10;
}
for(const x of [-0.316,0.316]){
 box('Window side rail',0.024,0.019,0.63,x,0.42,0,bronze);
 const panel=box('Clear side pane',0.001,0.70,0.58,x,0.775,0,glass);panel.isPickable=false;panel.alphaIndex=10;
}
box('Roof eave',0.84,0.05,0.84,0,1.21,0,bronze);
box('Eave brass trim',0.85,0.015,0.85,0,1.183,0,edge);
const roof=cylinder('Four-sided pitched canopy',1.17,0.24,1.35,bronze,0.35,4);roof.rotation.y=Math.PI/4;
box('Canopy upper collar',0.27,0.045,0.27,0,1.491,0,dark);
box('Canopy upper brass lip',0.28,0.016,0.28,0,1.52,0,edge);
cylinder('Handle pedestal',0.115,0.07,1.56,bronze,0.09,24);
const handle=place(CreateTorus('Carrying ring',{diameter:0.32,thickness:0.025,tessellation:56},scene),bronze,0,1.75,0);handle.rotation.x=Math.PI/2;
cylinder('Candle saucer',0.33,0.025,0.39,edge,0.30,48);
cylinder('Candle holder',0.19,0.055,0.425,bronze,0.22,48);
cylinder('Ivory candle',0.145,0.30,0.597,wax,0.133,40);
cylinder('Black wick',0.014,0.042,0.767,dark,0.012,12);
const flame=place(CreateSphere('Living flame',{diameter:1,segments:24},scene),fire,0,0.865,0);flame.scaling.set(0.105,0.255,0.105);
const glow=place(CreatePlane('Flame aura',{size:0.83,sideOrientation:2},scene),halo,0,0.88,0);glow.billboardMode=7;glow.isPickable=false;glow.alphaIndex=5;
// Three low pebbles give the lantern scale without competing with it.
for(const [i,x,z,s] of [[0,-0.82,0.19,0.19],[1,-0.69,0.37,0.13],[2,0.71,-0.47,0.17]]){
 const p=place(CreateSphere('Slate pebble '+(i+1),{diameter:1,segments:8},scene),pebble,x,0.10,z);p.scaling.set(s,0.08,s*0.78);p.rotation.y=i*0.8;
}
// Shader time has one owner; reset is deterministic and holds the authored still.
let started=null,time=0,frames=0;
function update(t){time=t;for(const m of materials){m.setFloat('time',t);m.setVector3('eye',camera.position);}}
const binding=await bindRender({scene,camera,interaction:{io_lock(){},release(){}},
 play(script){const config=JSON.parse(script);if(config.effect!=='flicker')throw Error('Unknown lantern effect');started=performance.now();update(0);},
 reset(){started=null;update(0);}});
await Promise.all(materials.map(m=>m.forceCompilationAsync(scene.meshes.find(mesh=>mesh.material===m))));
engine.runRenderLoop(()=>{update(started===null?0:(performance.now()-started)/1000);scene.render();frames++;});
window.lantern={scene,camera,binding,materials,flame,get time(){return time},get frames(){return frames},backend:webgpu?'WebGPU':'WebGL2'};
addEventListener('pagehide',()=>{engine.stopRenderLoop();binding.dispose();scene.dispose();engine.dispose();},{once:true});
