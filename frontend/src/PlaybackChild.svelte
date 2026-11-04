<script lang="ts">
  import {childNodes, openNodeDocument} from './canvas.js';
  import {readNativeStream} from './native-stream.js';
  import {onDestroy} from 'svelte';
  import PlaybackChild from './PlaybackChild.svelte';
  import PlaybackAsset from './PlaybackAsset.svelte';
  let {folder, path, ancestors, seen, onaction, onclip}: {folder:any; path:string; ancestors:string[]; seen:Set<string>; onaction:(path:string, view:string, key:string)=>void; onclip:(path:string,view:string,index:number,name:string)=>void}=$props();
  let loaded=$state(false), busy=$state(false), error=$state(''), actions=$state<any[]>([]), assets=$state<any[]>([]), children=$state<string[]>([]), depthLimit=$state(false);
  let generation=0;
  onDestroy(()=>{generation++;seen.delete(path)});
  async function expand(event:Event) {
    const target=event.currentTarget as HTMLDetailsElement;
    if (!target.open) {generation++;actions=[];assets=[];children=[];loaded=false;busy=false;error='';depthLimit=false;return}
    if (loaded || busy) return;
    const current=++generation;busy=true; error='';
    try {
      const {document}=await openNodeDocument(folder,path,true);
      const rows=[], discovered=[];
      for (const id of document.views) {
        const view=document.nodes.find((n:any)=>n.id===id);
        if (view && /\.(glb|gltf)$/i.test(view.path)) { discovered.push(view);continue; }
        if (!view || !/\.stream$/i.test(view.path) || view.application==='blender') continue;
        let declared=view.actions;
        if (declared?.length===0) continue;
        let reason='';
        try {
          const stream=readNativeStream(await folder.read(view.path),view.path);
          if (stream.application!=='godot') throw new Error('The view is not a Godot preview');
          declared ??= stream.actions||[];
          await folder.stat(stream.source);
          if (stream.assembly) await folder.stat(stream.source.replace(/project\.godot$/, 'assemble.py'));
        } catch (e) { reason=(e as Error).message; }
        if (!declared && reason) throw new Error(reason);
        for (const action of declared||[]) rows.push({view:id,label:action.label,key:action.key,reason});
      }
      if (!target.open || current!==generation) return;
      actions=rows;assets=discovered;depthLimit=ancestors.length>=8;
      if (!depthLimit) {
        const next=(await childNodes(folder,path,[...ancestors,path])).filter(child=>!seen.has(child));
        if (!target.open || current!==generation) return;
        if (seen.size+next.length>128) throw new Error('More than 128 linked nodes; narrow this branch');
        children=next;children.forEach(child=>seen.add(child));
      }
      loaded=true;
    } catch (e) { if(current===generation)error=(e as Error).message; }
    finally {if(current===generation)busy=false}
  }
</script>
<details ontoggle={expand}>
  <summary>{path.split('/').pop()} <small>· opens child preview</small></summary>
  {#if busy}<span class="note">Loading…</span>{/if}
  {#if error}<span class="note" role="status">Unavailable: {error}</span>{/if}
  {#if depthLimit}<span class="note">Nested playback depth limit reached (8)</span>{/if}
  {#if loaded && !actions.length && !assets.length && !children.length}<span class="note">No exported playback</span>{/if}
  {#each actions as action}
    <button role="menuitem" disabled={!!action.reason} title={action.reason || 'Opens the child preview'} onclick={() => onaction(path,action.view,action.key)}>{action.label} <small>· child preview{action.reason ? ` unavailable: ${action.reason}` : ''}</small></button>
  {/each}
  {#each assets as view (view.id)}<PlaybackAsset {folder} {path} {view} {onclip}/>{/each}
  {#each children as child (child)}
    <PlaybackChild {folder} path={child} ancestors={[...ancestors,path]} {seen} {onaction} {onclip} />
  {/each}
</details>
<style>
 details{padding-left:8px}summary{cursor:pointer;padding:6px;font-size:12px}small,.note{color:var(--muted);font-size:10px}.note{display:block;padding:5px 8px}button{display:block;width:100%;padding:6px 8px;border:0;background:transparent;text-align:left;font-size:12px}button:hover,button:focus-visible{background:var(--raised)}
</style>
