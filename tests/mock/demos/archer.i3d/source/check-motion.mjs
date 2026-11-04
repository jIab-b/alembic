// Exercise the authored pose function with Babylon's real transform math.
// This checks animation state without creating any rendering engine.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
if(!process.env.ALEMBIC_ROOT)throw Error('Set ALEMBIC_ROOT to the host repository');
const {Vector3,Quaternion,Matrix}=await import(pathToFileURL(resolve(process.env.ALEMBIC_ROOT,'frontend/node_modules/@babylonjs/core/Maths/math.vector.js')));
const source=readFileSync(process.argv[2],'utf8');
function node(parent=null,position=[0,0,0]){return {parent,position:Vector3.FromArray(position),rotation:Vector3.Zero(),scaling:Vector3.One(),enabled:true,setEnabled(x){this.enabled=x},computeWorldMatrix(){return this.getWorldMatrix()},getWorldMatrix(){const m=Matrix.Compose(Vector3.One(),Quaternion.RotationYawPitchRoll(this.rotation.y,this.rotation.x,this.rotation.z),this.position);return parent?m.multiply(parent.getWorldMatrix()):m}}}
const root=node(),body=node(root,[0,1.35,0]),head=node(body),bow=node(body),arrow=node(),target=node(),legs=[{hip:node(),knee:node()},{hip:node(),knee:node()}],hitRays=Array.from({length:20},()=>node());
const fireTrail=Array.from({length:36},()=>node()),impactFlash=node(),impactCore=node(),impactEmbers=Array.from({length:24},()=>node());
const effects=[...fireTrail,impactFlash,impactCore,...impactEmbers,...hitRays];
let draw=0;const bowPose=x=>draw=x,arm=()=>{},segment=()=>{};
const utils=source.slice(source.indexOf('const v='),source.indexOf('function mat('));
const motion=source.slice(source.indexOf('const shot='),source.indexOf('pose(0,null);'));
const run=new Function('Vector3','Quaternion','root','body','head','bow','arrow','target','legs','hitRays','bowPose','arm','segment','fireTrail','impactFlash','impactCore','impactEmbers',utils+motion+'return {pose,get phase(){return phase},shot}');
const model=run(Vector3,Quaternion,root,body,head,bow,arrow,target,legs,hitRays,bowPose,arm,segment,fireTrail,impactFlash,impactCore,impactEmbers);
for(const t of [2.6,3.1,3.6,4.3,4.85,4.999]){model.pose(t,'shoot');assert.equal(draw,1);assert.ok(arrow.enabled);assert.ok(legs.every(l=>l.hip.rotation.z===0));assert.ok(effects.every(m=>!m.enabled),'No fire before release');}
assert.ok(body.rotation.z>.20);const before=arrow.position.clone();model.pose(5,'shoot');assert.ok(Vector3.Distance(before,arrow.position)<.00001,'Continuous nock position across release');
model.pose(5.4,'shoot');assert.equal(model.phase,'flight');assert.ok(arrow.position.x>before.x);assert.ok(fireTrail.filter(m=>m.enabled).length>20,'Continuous fire trail during flight');
const trailSnapshot=fireTrail.map(m=>m.position.asArray());model.pose(5.4,'shoot');assert.deepEqual(fireTrail.map(m=>m.position.asArray()),trailSnapshot,'Same time produces identical flames');
model.pose(5.85,'shoot');assert.equal(model.phase,'impact');assert.equal(arrow.position.y,2.22);assert.equal(arrow.position.x,1.58);assert.ok(impactFlash.enabled&&impactCore.enabled&&impactEmbers.every(m=>m.enabled)&&hitRays.every(m=>m.enabled),'Large burst and embers at impact');assert.ok(impactFlash.scaling.y>1,'Fireball spans more than one scene unit');assert.ok(Math.abs(target.rotation.z)>.02,'Stronger target recoil');
model.pose(7,'shoot');assert.ok(effects.every(m=>!m.enabled),'All fire extinguishes before the scenario ends');
model.pose(5.85,'shoot');model.pose(0,'idle');assert.ok(effects.every(m=>!m.enabled),'Switching scenarios clears fire');
model.pose(0,null);assert.equal(arrow.enabled,false);assert.equal(body.rotation.z,0);assert.ok(effects.every(m=>!m.enabled),'Reset clears every effect');
for(let t=0;t<9;t+=.037){model.pose(t,'shoot');for(const m of effects)if(m.enabled){assert.ok([...m.position.asArray(),...m.scaling.asArray(),m.visibility].every(Number.isFinite),'Finite effect transforms');assert.ok(m.visibility>=0&&m.visibility<=1);}}
console.log(JSON.stringify({fullDrawSeconds:model.shot.release-model.shot.drawn,backwardLeanDegrees:.205*180/Math.PI,feetPlanted:true,releaseContinuous:true,flight:true,impact:true,fireTrail:true,largerBurst:true,effectsReset:true,reset:true}));
