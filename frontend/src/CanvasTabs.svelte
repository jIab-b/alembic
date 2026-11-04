<script module lang="ts">
  export type CanvasTab = {id: string; key: string; path: string; name: string; originKey?: string};
</script>
<script lang="ts">
  let {tabs, active, onselect, onclose, onnew, onfilemenu, renderPath = '', onrender}: {tabs: CanvasTab[]; active: string;
    onselect: (id: string) => void; onclose: (id: string) => void; onnew: () => void;
    onfilemenu?: (path: string, event: MouseEvent) => void; renderPath?: string; onrender?: () => void} = $props();
  let list = $state<HTMLDivElement>();
  $effect(() => {
    void active;
    queueMicrotask(() => list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({block: 'nearest', inline: 'nearest'}));
  });
  function key(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return;
    const index = tabs.findIndex(tab => tab.id === active);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
    if (next >= 0 || event.key === 'Delete') {
      event.preventDefault(); event.stopPropagation();
      if (next >= 0) { onselect(tabs[next].id); document.getElementById(`canvas-tab-${tabs[next].id}`)?.focus(); }
      else onclose(active);
    }
  }
</script>

<div class="canvas-tabs">
  <div class="tab-list" role="tablist" aria-label="Canvas tabs" tabindex="-1" bind:this={list} onkeydown={key}>
    {#each tabs as tab (tab.id)}
      <div class="tab" class:active={tab.id === active} role="presentation"
        onauxclick={event => { if (event.button === 1) { event.preventDefault(); onclose(tab.id); } }}>
        <button class="tab-name" id={`canvas-tab-${tab.id}`} role="tab" aria-selected={tab.id === active}
          aria-controls="canvas-surface" aria-label={tab.path || tab.name} title={tab.path || tab.name}
          tabindex={tab.id === active ? 0 : -1} onclick={() => onselect(tab.id)}
          oncontextmenu={tab.path && onfilemenu ? event => onfilemenu?.(tab.path, event) : undefined}><span>{tab.name}</span></button>
        <button class="close-tab" aria-label={`Close ${tab.path || tab.name}`} title="Close tab" tabindex="-1" onclick={() => onclose(tab.id)}>×</button>
      </div>
    {/each}
  </div>
  <button class="new-tab" aria-label="New file tab" title="New file tab" onclick={onnew}>+</button>
  {#if renderPath}<button class="render-tab" aria-label="Open render preview" title={renderPath} onclick={onrender}>Render</button>{/if}
</div>

<style>
  .canvas-tabs { display: flex; flex: 1; align-self: stretch; min-width: 0; }
  .tab-list { display: flex; gap: 0; min-width: 0; overflow-x: auto; scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
  .tab { display: flex; flex: 0 0 auto; min-width: 90px; max-width: 220px; border-right: 1px solid var(--line-strong); background: var(--field); }
  .tab.active { background: var(--canvas); }
  .tab:hover { background: var(--raised); }
  .tab:has(:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }
  button { border: 0; border-radius: 0; background: transparent; color: var(--muted); font-size: 12px; }
  .tab-name { display: flex; align-items: center; min-width: 0; padding: 0 10px; text-align: left; }
  .tab-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .active .tab-name { color: var(--text); }
  .close-tab { flex: none; width: 24px; padding: 0; font-size: 16px; }
  .new-tab { flex: none; width: 32px; padding: 0; font-size: 20px; }
  .render-tab { flex: none; padding: 0 12px; color: var(--text); border-left: 1px solid var(--line); }
  .tab button:hover:not(:disabled) { background: transparent; }
  .tab .close-tab:hover:not(:disabled) { background: var(--line-strong); color: var(--text); box-shadow: inset 0 0 0 1px var(--line-strong); }
  .tab button:focus-visible { outline: none; }
  .new-tab:hover { background: var(--line); }
</style>
