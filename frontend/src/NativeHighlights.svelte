<script lang="ts">
  import {onMount} from 'svelte';
  import {hull} from './native-camera.js';
  let {camera,volumes,active,tool,ondisarm,onplace,onmenu,onerror}:{camera:any;volumes:any[];active:string;tool:string;ondisarm:()=>void;onplace:(shape:string,at:any)=>void;onmenu:(id:string,x:number,y:number)=>void;onerror:(message:string)=>void}=$props();
  let paths=$state<{id:string;d:string}[]>([]);
  onMount(()=>{
    let previous='',frame=0;
    const tick=()=>{
      frame=requestAnimationFrame(tick);if(!camera?.ready)return;
      const box=camera.bounds(),key=JSON.stringify([camera.version,volumes,active,box.width,box.height]);if(key===previous)return;previous=key;
      const next=[];
      for(const v of volumes){
        let points=camera.projected(v);
        if(v.shape==='pick'){const p=camera.project(v.center);if(!p)continue;points=Array.from({length:24},(_,i)=>[p[0]+6*Math.cos(i*Math.PI/12),p[1]+6*Math.sin(i*Math.PI/12)])}
        const boundary=hull(points);if(boundary.length<3)continue;
        const d=boundary.map((p:number[],i:number)=>(i?'L':'M')+p.join(',')).join(' ')+'Z';next.push({id:v.id,d});
      }
      paths=next;
    };tick();return()=>cancelAnimationFrame(frame);
  });
  function place(event:PointerEvent){
    if(!tool||tool==='area')return;event.preventDefault();event.stopPropagation();const shape=tool;ondisarm();
    if(event.button===2){onmenu('',event.clientX,event.clientY);return}
    if(event.button!==0)return;
    void camera.locate(event.clientX,event.clientY).then((at:any)=>onplace(shape,at)).catch((error:Error)=>onerror(error.message));
  }
</script>
<svg class="native-hits" role="presentation" oncontextmenu={event=>event.preventDefault()}>
  {#each paths as path(path.id)}<path class="native-hit" data-native-highlight={path.id} d={path.d}></path>{/each}
</svg>
{#if tool && tool!=='area'}<div class="native-placement" role="presentation" oncontextmenu={event=>event.preventDefault()} onpointerdown={place}></div>{/if}
<style>
  .native-hits,.native-placement{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .native-hit{fill:transparent;stroke:none;pointer-events:all;cursor:var(--scene-cursor)}
  .native-placement{pointer-events:auto;cursor:var(--scene-cursor)}
</style>
