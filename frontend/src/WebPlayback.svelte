<script lang="ts">
  import {readPlaybacks} from './node-contract.js';
  let {folder,path,canvas,selected,ready,playing,error='',onplay,onreset}: {
    folder:any;path:string;canvas:any;selected:string;ready:boolean;playing:boolean;error:string;
    onplay:(id:string)=>Promise<void>;onreset:()=>Promise<void>
  }=$props();
  let menu=$state<HTMLDetailsElement>(),rows=$state<any[]>([]),issue=$state(''),busy=$state(false),running=$state(false);
  let generation=0;
  async function toggle(event:Event) {
    const open=(event.currentTarget as HTMLDetailsElement).open, current=++generation;
    if (!open) {rows=[];issue='';return}
    busy=true;issue='';rows=[];
    try {const next=readPlaybacks(await folder.read(path+'/playbacks.txt'),canvas);
      if(current===generation)rows=next;
    } catch(e) {if(current===generation && !/^404\b/.test((e as Error).message))issue=(e as Error).message}
    finally {if(current===generation)busy=false}
  }
  async function start(id:string) {if(running)return;running=true;try {issue='';await onplay(id);if(menu)menu.open=false}catch(e){issue=(e as Error).message}finally{running=false}}
  async function reset() {if(running)return;running=true;try {issue='';await onreset()}catch(e){issue=(e as Error).message}finally{running=false}}
</script>
<svelte:window onpointerdown={event => { if (menu?.open && !menu.contains(event.target as Node)) menu.open = false; }} onblur={() => { if(menu)menu.open=false; }} />
<details class="playback-menu" bind:this={menu} ontoggle={toggle}>
  <summary aria-label="Playback" title="Playback"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary><div role="menu" aria-label="Playback">
    {#if playing}<button onclick={reset} disabled={!ready || running}>Reset to inspect</button>{/if}
    {#if busy}<span class="note">Loading playbacks…</span>{/if}
    {#each rows as row}<button role="menuitem" disabled={!ready || running} title={ready ? `Duration ${row.duration ?? 'unknown'}; seek ${row.seek}` : 'Web preview is not ready'} onclick={()=>start(row.id)}>{row.label} <small>· {row.duration === null ? 'duration unknown' : `${row.duration}s`}</small></button>{/each}
    {#if !busy && !rows.length && !issue}<span class="note">No playback for this render</span>{/if}
    {#if issue || error}<span class="note" role="status">{issue || error}</span>{/if}
  </div>
</details>
<style>
  summary:hover, summary:focus-visible, button:hover:not(:disabled) { background: var(--raised); }

  .playback-menu{position:relative;font-size:12px}.playback-menu summary{cursor:pointer;padding:6px 9px;border:1px solid var(--line-strong);border-radius:7px}
  .playback-menu>div{position:absolute;z-index:31;top:calc(100% + 5px);right:0;min-width:200px;max-height:50dvh;overflow:auto;padding:4px;background:var(--panel);border:1px solid var(--line-strong);border-radius:8px;box-shadow:0 8px 24px #0003}
  button{display:block;width:100%;padding:7px 9px;border:0;background:transparent;text-align:left;color:inherit}button:hover:not(:disabled){background:var(--raised)}button:disabled{opacity:.55}.note{display:block;padding:6px;color:var(--muted)}
</style>
