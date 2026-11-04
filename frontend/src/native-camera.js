import {Matrix4,Vector3} from '../../render/native/math.js';
import {half} from './gltf.js';

// A camera mirror only. Camera movement continues to belong to the native app.
export class NativeCamera {
  constructor(rpc,bounds,capture,source=''){this.rpc=rpc;this.bounds=bounds;this.capture=capture;this.source=source;this.state=null;this.version=0;this.radius=.5}
  update(state){
    if(!state||!['clip','view','world'].every(k=>Array.isArray(state[k])&&state[k].length===16&&state[k].every(Number.isFinite))||!state.region?.every(Number.isFinite)||state.region[2]<=0||state.region[3]<=0||state.width<=0||state.height<=0)throw Error('Invalid native camera');
    const key=JSON.stringify(state);if(key===this.key)return;this.key=key;this.state=state;this.version++;
    this.clip=new Matrix4().fromArray(state.clip);this.view=new Matrix4().fromArray(state.view);
  }
  get ready(){return !!this.state}
  frame(){const box=this.bounds(),s=this.state,scale=Math.min(box.width/s.width,box.height/s.height);return {box,scale,x:(box.width-s.width*scale)/2,y:(box.height-s.height*scale)/2}}
  clientPoint(point){const f=this.frame();return [f.box.left+f.x+point[0]*f.scale,f.box.top+f.y+point[1]*f.scale]}
  project(point){
    if(!this.ready)return null;
    const p=new Vector3(...point);if(p.clone().applyMatrix4(this.view).z>=0)return null;
    p.applyMatrix4(this.clip);const s=this.state,[rx,ry,rw,rh]=s.region,f=this.frame();
    return [f.x+(rx+(p.x+1)*rw/2)*f.scale,f.y+(s.height-ry-(p.y+1)*rh/2)*f.scale];
  }
  axes(){const e=this.state.world;return {right:e.slice(0,3),up:e.slice(4,7),forward:e.slice(8,11).map(v=>-v)}}
  dragFrame(point){const s=this.state,f=this.frame(),depth=-new Vector3(...point).applyMatrix4(this.view).z;return {...this.axes(),scale:2*(s.orthographic?1:Math.max(.001,depth))/(Math.abs(s.windowY)*s.region[3]*f.scale)}}
  pose(){return {position:this.state.world.slice(12,15),forward:this.axes().forward}}
  replayPose(){const p=this.pose();return {position:p.position,target:p.position.map((v,k)=>v+p.forward[k]*this.state.distance)}}
  defaultRadius(){return this.radius}
  tool(){} volumes(){} previewSolids(){}
  async locate(x,y){
    if(!this.ready)throw Error('Native camera is still starting');
    const f=this.frame(),point=[(x-f.box.left-f.x)/f.scale,(y-f.box.top-f.y)/f.scale];
    const result=await this.rpc({operation:'pick',point,camera:this.state});this.update(result.camera);
    this.radius=Math.max(.001,this.dragFrame(result.point).scale*28);
    return {...result,radius:this.radius};
  }
  async resolve(selection){const result=await this.rpc({operation:'objects',selection,...(selection.area?{pixelArea:this.sourceArea(selection.area)}:{})});this.update(result.camera);return {...result,context:{...result.context,source:this.source}}}
  sourceArea(area){const f=this.frame(),s=this.state,[x,y,w,h]=area;const left=Math.max(0,(x*f.box.width-f.x)/f.scale),top=Math.max(0,(y*f.box.height-f.y)/f.scale),right=Math.min(s.width,((x+w)*f.box.width-f.x)/f.scale),bottom=Math.min(s.height,((y+h)*f.box.height-f.y)/f.scale);return [left/s.width,top/s.height,Math.max(1,right-left)/s.width,Math.max(1,bottom-top)/s.height]}
  projected(selection){
    if(!this.ready||!selection.center)return [];
    const h=half(selection.shape==='pick'?{...selection,shape:'sphere'}:selection),center=selection.center,points=[];
    if(selection.shape==='box')for(let i=0;i<8;i++)points.push(center.map((v,k)=>v+(i>>k&1?h[k]:-h[k])));
    else for(let axis=0;axis<3;axis++)for(let i=0;i<32;i++){const p=[...center],a=(axis+1)%3,b=(axis+2)%3,t=i*Math.PI/16;p[a]+=Math.cos(t)*h[a];p[b]+=Math.sin(t)*h[b];points.push(p)}
    return points.map(p=>this.project(p)).filter(Boolean);
  }
  async crop(selection){
    if(selection.area)return this.capture(this.sourceArea(selection.area));
    const points=this.projected(selection);if(!points.length)return null;
    const f=this.frame(),xs=points.map(p=>(p[0]-f.x)/f.scale),ys=points.map(p=>(p[1]-f.y)/f.scale),s=this.state;
    const x=Math.max(0,Math.min(...xs)-12),y=Math.max(0,Math.min(...ys)-12),right=Math.min(s.width,Math.max(...xs)+12),bottom=Math.min(s.height,Math.max(...ys)+12);
    return this.capture([x/s.width,y/s.height,Math.max(1,right-x)/s.width,Math.max(1,bottom-y)/s.height]);
  }
}

export function hull(points){
  const sorted=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const side=values=>{const out=[];for(const p of values){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p)}return out};
  return [...side(sorted).slice(0,-1),...side([...sorted].reverse()).slice(0,-1)];
}
