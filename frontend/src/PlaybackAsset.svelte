<script lang="ts">
  import {animationNames} from '../../render/model.js';
  let {folder,path,view,onclip}:{folder:any;path:string;view:any;onclip:(path:string,view:string,index:number,name:string)=>void}=$props();
  let names=$state<string[]>([]),busy=$state(false),error=$state(''),stamp=$state('');
  async function expand(event:Event) {
    if (!(event.currentTarget as HTMLDetailsElement).open || busy) return;
    busy=true;error='';
    try {
      const stat=await folder.stat(view.path), next=`${stat.size}:${stat.lastModified}`;
      if (next!==stamp) {
        if (stat.size>16*1024*1024) throw new Error('Asset exceeds the 16 MiB preview limit');
        names=animationNames(await folder.read(view.path));stamp=next;
      }
    } catch(e){names=[];error=(e as Error).message} finally{busy=false}
  }
</script>
<details ontoggle={expand}>
  <summary>{view.label} clips <small>· opens child preview</small></summary>
  {#if busy}<span class="note">Loading clips…</span>{/if}
  {#if error}<span class="note" role="status">Unavailable: {error}</span>{/if}
  {#if stamp && !names.length && !busy}<span class="note">No animation clips</span>{/if}
  {#each names as name,i}<button role="menuitem" onclick={()=>onclip(path,view.id,i,name)}>{name} <small>· child preview</small></button>{/each}
</details>
<style>details{padding-left:8px}summary{cursor:pointer;padding:6px;font-size:12px}small,.note{color:var(--muted);font-size:10px}.note{display:block;padding:5px 8px}button{display:block;width:100%;padding:6px 8px;border:0;background:transparent;text-align:left;font-size:12px}button:hover,button:focus-visible{background:var(--raised)}</style>
