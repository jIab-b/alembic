<script lang="ts">
  import {childNodes} from './canvas.js';
  import PlaybackChild from './PlaybackChild.svelte';
  let {folder,path,clips=[],currentClip='',currentAction='',actions=[],ready=false,onclip,onaction,onchild,onchildclip}: {folder:any;path:string;clips:string[];currentClip:string;currentAction:string;actions:any[];ready:boolean;onclip:(n:number)=>void;onaction:(key:string)=>void;onchild:(path:string,view:string,key:string)=>void;onchildclip:(path:string,view:string,index:number,name:string)=>void}=$props();
  let menu=$state<HTMLDetailsElement>(),children=$state<string[]>([]),loaded=$state(false),busy=$state(false),error=$state('');
  const seen=new Set<string>(); let generation=0;
  async function expand(event:Event){
    const target=event.currentTarget as HTMLDetailsElement;
    if (!target.open) {generation++;children=[];loaded=false;busy=false;error='';seen.clear();return}
    if (loaded || busy || !path) return;
    const current=++generation;busy=true;error='';seen.add(path);try{const next=(await childNodes(folder,path)).filter(child=>!seen.has(child));if(!target.open || current!==generation)return;children=next;children.forEach(child=>seen.add(child));loaded=true}catch(e){if(target.open && current===generation)error=(e as Error).message}finally{if(current===generation)busy=false}
  }
  function clip(i:number){if(menu)menu.open=false;onclip(i)}
  function action(key:string){if(menu)menu.open=false;onaction(key)}
</script>
<svelte:window onpointerdown={event => { if (menu?.open && !menu.contains(event.target as Node)) menu.open = false; }} onblur={() => { if(menu)menu.open=false; }} />
<details class="playback-menu" bind:this={menu} ontoggle={expand}>
  <summary aria-label="Playback" title="Playback"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary><div role="menu" aria-label="Playback">
    {#each clips as name, i}<button role="menuitemradio" aria-checked={name===currentClip} onclick={() => clip(i)}>{name}</button>{/each}
    {#each actions as item}<button role="menuitemradio" aria-checked={item.key===currentAction} disabled={!ready} title={ready?'Script action; duration and stop are not available':'Preview is still starting'} onclick={() => action(item.key)}>{item.label} <small>· duration unknown</small></button>{/each}
    {#if busy}<span class="note">Loading child nodes…</span>{/if}
    {#if error}<span class="note" role="status">Child nodes unavailable: {error}</span>{/if}
    {#each children as child (child)}<PlaybackChild {folder} path={child} ancestors={[path]} {seen} onaction={onchild} onclip={onchildclip}/>{/each}
    {#if loaded && !clips.length && !actions.length && !children.length}<span class="note">No playback available for this view</span>{/if}
  </div>
</details>
<style>
  summary:hover, summary:focus-visible, button:hover:not(:disabled) { background: var(--raised); }

 .playback-menu{position:relative;font-size:12px}.playback-menu summary{cursor:pointer;padding:6px 9px;border:1px solid var(--line-strong);border-radius:7px}.playback-menu>div{position:absolute;z-index:31;top:calc(100% + 5px);right:0;min-width:190px;max-height:50dvh;overflow:auto;padding:4px;background:var(--panel);border:1px solid var(--line-strong);border-radius:8px;box-shadow:0 8px 24px #0003}.playback-menu>div>button{display:block;width:100%;padding:7px 9px;border:0;background:transparent;text-align:left}.playback-menu>div>button[aria-checked=true]{background:var(--raised)}.note{display:block;padding:6px;color:var(--muted)}
</style>
