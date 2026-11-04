<script>
  import NativeHighlights from '../NativeHighlights.svelte';
  let {v}=$props();
</script>
{#if v.spatialViewer?.ready && !v.minimal && !v.interactionState?.io_lock}
  <div class="surface-hits"><NativeHighlights camera={v.spatialViewer}
    volumes={v.visible.filter(s=>s.center)} active={v.active} tool={v.tool}
    ondisarm={()=>v.tool=''} onplace={(shape,at)=>v.run(()=>v.placeNative(shape,at))}
    onmenu={(id,x,y)=>v.run(()=>v.openMenu(id,x,y))} onerror={message=>v.error=message} /></div>
{/if}
<style>
  .surface-hits{display:contents}
</style>
