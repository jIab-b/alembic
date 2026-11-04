import {Engine,Scene,ArcRotateCamera,Vector3,HemisphericLight,CreateBox,bindRender} from '/assets/play/renderer.js';
import {WebGPUEngine,StandardMaterial,Color3,Quaternion,TransformNode,Mesh,VertexData,CreateSphere,CreateCylinder,DirectionalLight,ShadowGenerator,alignSharedBuffers,registerSharedShaders} from './assets/runtime.min.js';
const canvas=document.querySelector('canvas');
const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
const engine=adapter?new WebGPUEngine(canvas,{antialias:true}):new Engine(canvas,true,{disableWebGL1Support:true,failIfMajorPerformanceCaveat:true,preserveDrawingBuffer:true});
if(adapter)await engine.initAsync();else registerSharedShaders(engine);
engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio,1.5));
const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor.set(.69,.75,.73,1);
const camera=new ArcRotateCamera('Inspection',0,1,12,new Vector3(.45,1.7,0),scene);
camera.setPosition(new Vector3(.6,5.8,15.4));camera.fov=.63;camera.minZ=.05;
const probe=CreateBox('bootstrap',{size:.001},scene);alignSharedBuffers(probe);probe.dispose();
const ambient=new HemisphericLight('Soft sky',new Vector3(0,1,.5),scene);ambient.intensity=.65;ambient.groundColor=new Color3(.39,.37,.31);
const sun=new DirectionalLight('Studio key',new Vector3(.45,-1,-.6),scene);sun.position=new Vector3(-4,9,6);sun.intensity=.85;
const shadows=new ShadowGenerator(2048,sun);shadows.usePercentageCloserFiltering=true;shadows.bias=.0005;shadows.normalBias=.025;
const v=a=>Vector3.FromArray(a),mix=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*t),clamp=t=>Math.max(0,Math.min(1,t)),smooth=t=>{t=clamp(t);return t*t*(3-2*t)};
function mat(name,hex,spec=.065){const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(hex);m.specularColor=new Color3(spec,spec,spec);m.specularPower=42;return m;}
const green=mat('Enamel • deep pine','#23584c'),lightGreen=mat('Enamel • sage edge','#508374'),dark=mat('Deep leather and eye ink','#263334'),skin=mat('Warm painted face','#e5b27d'),gold=mat('Satin brass','#cba658',.3),cream=mat('Linen and target ivory','#eee0b7'),leather=mat('Oxblood leather','#73483c'),wood=mat('Honey ash bow','#b97c42'),red=mat('Terracotta target rings','#b85139'),ground=mat('Warm porcelain plinth','#b9b9a1'),floor=mat('Studio backdrop','#b5c2bc');
function group(name,parent,pos=[0,0,0]){const n=new TransformNode(name,scene);n.parent=parent;n.position.copyFrom(v(pos));return n;}
function finish(m,material,parent,pos){m.material=material;m.parent=parent;if(pos)m.position.copyFrom(v(pos));shadows.addShadowCaster(m);m.receiveShadows=true;return m;}
// Rounded cuboids are actual bevelled geometry, with broad flat faces and soft toy edges.
function rounded(name,size,r,material,parent,pos){
 const positions=[],normals=[],indices=[],uvs=[],steps=[-1,-.92,-.71,-.38,0,.38,.71,.92,1];
 const h=size.map(s=>s/2),inner=h.map(s=>s-r);
 for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
  const u=(axis+1)%3,w=(axis+2)%3,start=positions.length/3;
  for(const b of steps)for(const a of steps){
   const p=[0,0,0];p[axis]=sign*h[axis];p[u]=a*h[u];p[w]=b*h[w];
   const q=p.map((x,i)=>Math.max(-inner[i],Math.min(inner[i],x))),n=v(p.map((x,i)=>x-q[i])).normalize();
   positions.push(...q.map((x,i)=>x+n.asArray()[i]*r));normals.push(...n.asArray());uvs.push((a+1)/2,(b+1)/2);
  }
  for(let j=0;j<8;j++)for(let i=0;i<8;i++){const a=start+j*9+i,b=a+1,c=a+9,d=c+1;indices.push(...(sign>0?[a,b,c,b,d,c]:[a,c,b,b,c,d]));}
 }
 const m=new Mesh(name,scene),data=new VertexData();Object.assign(data,{positions,normals,indices,uvs});data.applyToMesh(m);m.sideOrientation=1;return finish(m,material,parent,pos);
}
function sphere(name,size,material,parent,pos){const m=finish(CreateSphere(name,{diameter:1,segments:16},scene),material,parent,pos);m.scaling.copyFrom(v(size));return m;}
function cylinder(name,diameter,height,material,parent,pos,top=diameter){return finish(CreateCylinder(name,{diameterBottom:diameter,diameterTop:top,height,tessellation:40},scene),material,parent,pos);}
function rod(name,a,b,r,material,parent){const m=cylinder(name,r*2,1,material,parent);segment(m,a,b);return m;}
function segment(m,a,b){const va=v(a),vb=v(b),d=vb.subtract(va);m.position.copyFrom(va.add(vb).scale(.5));m.scaling.y=d.length();m.rotationQuaternion=Quaternion.FromUnitVectorsToRef(new Vector3(0,1,0),d.normalize(),new Quaternion());}
const base=rounded('Oval-edged display terrain',[8.7,.23,3.7],.11,ground,null,[.45,-.11,0]);
rounded('Lower inset plinth',[8.5,.10,3.5],.045,dark,null,[.45,-.25,0]);
// The display plinth is framed against a clean, text-free studio background.
const root=group('Woodland guard • articulated');root.position.x=-2.1;
const hips=group('Pelvis',root,[0,1.05,0]),body=group('Breathing chest',root,[0,1.35,0]);
rounded('Padded tunic',[.68,.77,1.02],.13,cream,body,[0,.17,0]);
rounded('Breastplate',[.77,.81,1.12],.14,green,body,[.025,.43,0]);
rounded('Brass chest badge',[.045,.28,.22],.035,gold,body,[.425,.5,0]);
rounded('Wide waist belt',[.77,.19,1.12],.055,leather,body,[0,-.03,0]);
rounded('Solid belt buckle',[.09,.22,.25],.035,gold,body,[.42,-.03,0]);
for(const z of [-.34,.34]){const flap=rounded('Armour skirt panel',[.75,.36,.47],.07,green,body,[.01,-.28,z]);flap.rotation.x=z*.2;}
const head=group('Head and helmet',body,[0,1.09,0]);
cylinder('Scarf collar',.65,.2,gold,head,[0,-.13,0]);
rounded('Rounded painted face',[.79,.72,.87],.2,skin,head,[.02,.28,0]);
rounded('Small nose',[.16,.16,.18],.065,skin,head,[.45,.29,0]);
for(const z of [-.225,.225]){
 sphere('Inlaid dark eye',[.035,.095,.073],dark,head,[.416,.38,z]);
 const brow=rounded('Determined eyebrow',[.037,.045,.16],.018,dark,head,[.421,.49,z]);brow.rotation.x=z>0?-.13:.13;
 rounded('Helmet cheek guard',[.38,.35,.13],.06,green,head,[-.13,.15,z>0?.44:-.44]);
}
rounded('Quiet smile',[.023,.028,.18],.012,leather,head,[.421,.14,0]);
sphere('Domed helmet',[.99,.66,1.12],green,head,[-.06,.66,0]);
rounded('Heavy helmet brow',[1.02,.13,1.15],.06,lightGreen,head,[-.015,.51,0]);
rounded('Brass helmet crest',[.62,.055,.1],.025,gold,head,[-.04,.98,0]);
const feather=group('Ochre helmet plume',head,[-.3,.94,0]);feather.rotation.z=-.4;
sphere('Swept plume',[.18,.67,.24],gold,feather,[0,.25,0]);
const legs=[];
for(const [i,z] of [-.34,.34].entries()){
 const hip=group('Hip '+i,hips,[0,0,z]),knee=group('Knee '+i,hip,[0,-.48,0]);
 rounded('Trouser upper '+i,[.47,.55,.46],.12,leather,hip,[0,-.23,0]);
 rounded('Tall boot '+i,[.49,.47,.49],.10,dark,knee,[0,-.21,0]);
 rounded('Boot toe '+i,[.75,.27,.53],.11,dark,knee,[.14,-.43,0]);
 rounded('Brass boot cuff '+i,[.51,.11,.51],.035,gold,knee,[0,-.025,0]);
 legs.push({hip,knee});
}
// A back quiver with four permanently stocked arrows.
const quiver=group('Back quiver',body,[-.51,.3,-.22]);quiver.rotation.x=-.16;quiver.rotation.z=-.22;
cylinder('Leather arrow case',.39,.9,leather,quiver,[0,.19,0]);cylinder('Quiver rim',.45,.12,gold,quiver,[0,.66,0]);
for(let i=0;i<4;i++){const z=(i%2-.5)*.13,x=(Math.floor(i/2)-.5)*.13;rod('Spare arrow shaft '+i,[x,.55,z],[x,1.12+i*.05,z],.018,wood,quiver);rounded('Spare feather '+i,[.10,.22,.035],.015,cream,quiver,[x,1.03+i*.05,z]);}
// Shoulder, elbow and wrist endpoints are animated together, keeping the hands on the bow/string.
const arms=[];
for(let i=0;i<2;i++){
 const shoulder=[0,.87,i===0?-.54:.54];
 const pauldron=sphere('Rounded shoulder armour '+i,[.68,.48,.57],green,body,shoulder);
 const upper=rod('Upper sleeve '+i,shoulder,[.18,.43,shoulder[2]],.20,cream,body);
 const elbow=sphere('Elbow joint '+i,[.33,.33,.33],leather,body,[0,0,0]);
 const fore=rod('Leather bracer '+i,[0,0,0],[0,1,0],.18,leather,body);
 const hand=rounded('Gloved hand '+i,[.31,.32,.33],.11,skin,body,[0,0,0]);
 arms.push({shoulder,upper,elbow,fore,hand});
}
function arm(i,elbow,hand){const a=arms[i];segment(a.upper,a.shoulder,elbow);a.elbow.position.copyFrom(v(elbow));segment(a.fore,elbow,hand);a.hand.position.copyFrom(v(hand));}
const bow=group('Ash recurve bow',body),limbs=[];
for(let i=0;i<20;i++)limbs.push(rod('Curved bow limb '+i,[0,0,0],[0,1,0],.055,i===9||i===10?leather:wood,bow));
const grip=rounded('Bound bow grip',[.15,.34,.17],.04,leather,bow,[0,0,0]);
const strings=[rod('Upper bowstring',[0,0,0],[0,1,0],.012,cream,bow),rod('Lower bowstring',[0,0,0],[0,1,0],.012,cream,bow)];
function bowPose(draw){
 const points=[];for(let i=0;i<=20;i++){const t=-1+i/10;points.push([-.30*t*t-draw*.09*Math.abs(t),t*1.15,0]);}
 limbs.forEach((m,i)=>segment(m,points[i],points[i+1]));
 segment(strings[0],points[0],[-.30-draw*.85,0,0]);segment(strings[1],[-.30-draw*.85,0,0],points[20]);
}
function makeArrow(){const n=group('Flying arrow');rod('Arrow shaft',[0,0,0],[1.5,0,0],.022,wood,n);const tip=cylinder('Metal arrowhead',.13,.21,gold,n,[1.55,0,0],0);tip.rotation.z=-Math.PI/2;for(let i=0;i<3;i++){const f=rounded('Ivory fletching '+i,[.3,.10,.025],.01,cream,n,[.16,.052,0]);f.rotation.x=i*Math.PI*2/3;f.position.y=Math.cos(i*Math.PI*2/3)*.052;f.position.z=Math.sin(i*Math.PI*2/3)*.052;}return n;}
const arrow=makeArrow();
const target=group('Archery target',null,[3.3,2.22,0]);target.rotation.y=.5;
for(const z of [-.54,.54])rod('Target trestle',[3.5,.01,z],[3.45,2.28,z*.65],.075,wood);
rod('Rear target leg',[4.15,.02,-.1],[3.52,2.28,0],.07,wood);
rod('Trestle crossbar',[3.51,.74,-.54],[3.51,.74,.54],.06,wood);
for(const [i,d] of [1.9,1.64,1.30,.94,.61,.28].entries()){
 const disc=cylinder('Target ring '+i,d,i===0?.22:.025,[wood,cream,red,cream,red,gold][i],target,[i===0?0:-.13-(i-1)*.02,0,0]);disc.rotation.z=Math.PI/2;
}
// Fixed pools keep the fire deterministic and avoid per-frame mesh creation.
function fireMaterial(name,hex){const m=mat(name,hex,0);m.disableLighting=true;m.emissiveColor=Color3.FromHexString(hex);return m;}
const flameOrange=fireMaterial('Fire • orange envelope','#ff6418'),flameGold=fireMaterial('Fire • amber','#ffbc35'),flameWhite=fireMaterial('Fire • hot centre','#fff2b3');
function effectMesh(m,material){m.material=material;m.isPickable=false;m.receiveShadows=false;m.setEnabled(false);return m;}
function fireBall(name,material){return effectMesh(CreateSphere(name,{diameter:1,segments:8},scene),material);}
const fireTrail=Array.from({length:36},(_,i)=>fireBall('Arrow flame trail '+i,i%3===0?flameWhite:i%3===1?flameOrange:flameGold));
const impactFlash=fireBall('Impact fireball',flameOrange),impactCore=fireBall('Impact hot flash',flameWhite);
const impactEmbers=Array.from({length:24},(_,i)=>fireBall('Impact flying ember '+i,i%3===0?flameWhite:flameGold));
const hitRays=Array.from({length:20},(_,i)=>effectMesh(CreateCylinder('Impact fire streak '+i,{diameter:.055,height:1,tessellation:8},scene),i%2?flameOrange:flameGold));
const shot={raise:1.1,drawn:2.6,leanStart:3.6,leanEnd:4.8,release:5,impact:5.65,recover:6.4,rest:7.6};
const releaseLean=.205; // About twelve degrees back, with both boots planted.
let current=null,started=0,time=0,frames=0,phase='inspect';
function flightSample(t){
 const release=v([-.13,.94,-.12]).applyRotationQuaternion(Quaternion.RotationYawPitchRoll(-.12,0,releaseLean)).add(v([-2.1,1.35,0])).asArray();
 const hit=[1.58,2.22,0],u=clamp((t-shot.release)/(shot.impact-shot.release)),p=mix(release,hit,u);p[1]+=.28*4*u*(1-u);
 return {position:v(p),direction:v([hit[0]-release[0],hit[1]-release[1]+1.12*(1-2*u),hit[2]-release[2]]).normalize(),u};
}
function updateFire(t,mode){
 fireTrail.forEach((m,i)=>{
  const lag=i*.009,emitted=t-lag,life=lag/.34;
  const active=mode==='shoot'&&emitted>=shot.release&&emitted<shot.impact;
  m.setEnabled(active);if(!active)return;
  const sample=flightSample(emitted),p=sample.position.add(sample.direction.scale(1.46));
  p.y+=lag*.9+Math.sin(i*2.4+t*31)*.045*life;p.z+=Math.cos(i*2.1+t*24)*.07*life;
  m.position.copyFrom(p);m.rotationQuaternion=Quaternion.FromUnitVectorsToRef(new Vector3(1,0,0),sample.direction,new Quaternion());
  const size=(.23*(1-life)+.035)*(1+.16*Math.sin(t*42+i));
  m.scaling.set(size*(2.8+life),size,size*.8);m.visibility=(1-life)*.9;
 });
 const age=t-shot.impact,active=mode==='shoot'&&age>=0&&age<1.1;
 impactFlash.setEnabled(active&&age<.5);impactCore.setEnabled(active&&age<.28);
 if(active){
  const burst=Math.sin(Math.PI*clamp(age/.5)),core=Math.sin(Math.PI*clamp(age/.28));
  impactFlash.position.set(3.01,2.22,.08);impactFlash.scaling.set(.65*burst,1.35*burst,1.35*burst);impactFlash.visibility=1-clamp(age/.5);
  impactCore.position.set(2.93,2.22,.12);impactCore.scaling.set(.5*core,.85*core,.85*core);impactCore.visibility=1-clamp(age/.28);
 }
 hitRays.forEach((m,i)=>{
  m.setEnabled(active&&age<.7);if(!active||age>=.7)return;
  const a=i*Math.PI*2/hitRays.length,r=.18+age*2.4,length=(.32+(i%3)*.09)*(1-age/.7);
  segment(m,[3.00-age*.18,2.22+Math.cos(a)*r,.08+Math.sin(a)*r],[3.00-age*.18,2.22+Math.cos(a)*(r+length),.08+Math.sin(a)*(r+length)]);m.visibility=1-age/.7;
 });
 impactEmbers.forEach((m,i)=>{
  m.setEnabled(active);if(!active)return;
  const a=i*2.39996,speed=1.05+(i%5)*.23,r=age*speed;
  m.position.set(3.01-age*(.35+(i%4)*.25),2.22+Math.cos(a)*r+.45*age-1.2*age*age,.08+Math.sin(a)*r);
  const size=(.065+(i%3)*.022)*(1-age/1.1);m.scaling.set(size*1.8,size,size);m.visibility=1-age/1.1;
 });
}
function pose(t,mode){
 root.position.set(-2.1,0,0);root.rotation.set(0,-.38,0);body.position.y=1.35;body.rotation.set(0,0,0);head.rotation.set(0,0,0);
 for(const l of legs){l.hip.rotation.set(0,0,0);l.knee.rotation.set(0,0,0);}
 let draw=0,lift=0;phase=mode||'inspect';
 if(mode==='idle'){body.position.y+=Math.sin(t*2.1)*.025;head.rotation.y=Math.sin(t*.85)*.12;lift=.04*Math.sin(t*2.1);}
 if(mode==='walk'){
  const cycle=t*Math.PI*2/1.05;root.position.y=.045*(1-Math.cos(2*cycle));body.rotation.y=.06*Math.sin(cycle);head.rotation.y=-body.rotation.y;
  legs.forEach((l,i)=>{const p=cycle+i*Math.PI;l.hip.rotation.z=.44*Math.sin(p);l.knee.rotation.z=-.48*Math.max(0,Math.cos(p));});lift=.09*Math.sin(cycle);body.rotation.z=.025*Math.sin(2*cycle);
 }
 if(mode==='shoot'){
  const raise=smooth(t/shot.raise),pull=smooth((t-shot.raise)/(shot.drawn-shot.raise)),relax=smooth((t-shot.recover)/(shot.rest-shot.recover));
  const lean=smooth((t-shot.leanStart)/(shot.leanEnd-shot.leanStart));lift=raise*(1-relax);
  root.rotation.y=-.38*(1-raise*(1-relax));
  draw=pull*(1-smooth((t-shot.release)/.12));head.rotation.y=-.11*raise;body.rotation.y=-.12*raise;body.rotation.z=(-.045*pull+(.045+releaseLean)*lean)*(1-relax);
  phase=t<shot.raise?'raise':t<shot.drawn?'draw':t<shot.leanStart?'aim':t<shot.release?'lean':t<shot.impact?'flight':t<shot.recover?'impact':'recover';
 }
 const ready=mode==='shoot'?lift:0;
 const bowHand=mix([.48,.26,-.54],[1.02,.94,-.12],ready);bowHand[1]+=mode==='shoot'?0:lift;
 bow.position.copyFrom(v(bowHand));bow.rotation.z=mode==='shoot'?-.06*(1-ready):-.14;
 bowPose(draw);
 const drawHand=mode==='shoot'?mix([.2,.14,.58],[bowHand[0]-.3-draw*.85,bowHand[1],bowHand[2]],ready):[.16,.18-lift,.58];
 arm(0,mix([.21,.48,-.69],[.52,.91,-.4],ready),bowHand);
 arm(1,mix([.16,.48,.73],[-.40-.2*draw,.98,.64],ready),drawHand);
 arrow.setEnabled(mode==='shoot'&&t>.65);
 updateFire(t,mode);target.rotation.z=0;
 if(mode==='shoot'&&t<shot.release){
  body.computeWorldMatrix(true);bow.computeWorldMatrix(true);const tail=Vector3.TransformCoordinates(new Vector3(-.3-draw*.85,0,0),bow.getWorldMatrix());
  arrow.position.copyFrom(tail);arrow.rotationQuaternion=Quaternion.FromUnitVectorsToRef(new Vector3(1,0,0),v([3.19,2.22,0]).subtract(tail).normalize(),new Quaternion());
 }else if(mode==='shoot'){
  const {position,direction,u}=flightSample(t);arrow.position.copyFrom(position);
  arrow.rotationQuaternion=Quaternion.FromUnitVectorsToRef(new Vector3(1,0,0),u<1?direction:new Vector3(1,0,0),new Quaternion());
  if(t>=shot.impact){const age=t-shot.impact;arrow.rotationQuaternion=Quaternion.RotationYawPitchRoll(0,0,Math.sin(age*33)*.045*Math.exp(-age*7));target.rotation.z=.09*Math.sin(age*27)*Math.exp(-age*4.5);
  }
 }
}
pose(0,null);
await scene.whenReadyAsync();
const binding=await bindRender({scene,camera,interaction:{io_lock(){},release(){}},play(script){const c=JSON.parse(script);if(!['idle','walk','shoot'].includes(c.animation))throw Error('Unknown archer animation');current=c.animation;started=performance.now();pose(0,current);},reset(){current=null;time=0;pose(0,null);}});
engine.runRenderLoop(()=>{time=current?(performance.now()-started)/1000:0;pose(time,current);scene.render();frames++;});
window.archer={scene,camera,binding,root,body,head,legs,arms,bow,arrow,target,fireTrail,impactFlash,impactCore,impactEmbers,hitRays,get time(){return time},get phase(){return phase},get animation(){return current},get frames(){return frames},backend:adapter?'WebGPU':'WebGL2'};
addEventListener('pagehide',()=>{engine.stopRenderLoop();binding.dispose();scene.dispose();engine.dispose();},{once:true});
