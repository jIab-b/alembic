<script lang="ts">
  let {canvas, selected, onchange, permissions = {}, interaction = null, oninteraction}: {canvas: any;
    selected: string; onchange: (id: string) => void; permissions?:any; interaction?:any;
    oninteraction?:(key:'io_lock')=>void} = $props();
  let expanded = $state(false), root: HTMLDivElement, trigger: HTMLButtonElement;
  const views = $derived(canvas.views.map((id: string) => canvas.nodes.find((node: any) => node.id === id)));
  const current = $derived(views.find((node: any) => node.id === selected));
  const failure = $derived(current?.build?.state === 'failed' ? current.build.message || 'Render failed; showing the last available export' : '');
  function close(focus = false) {
    expanded = false;
    if (focus) trigger?.focus();
  }
  function focusView(last = false) {
    expanded = true;
    queueMicrotask(() => {
      const items = root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
      (last ? items[items.length - 1] : root.querySelector<HTMLButtonElement>('[aria-checked="true"]') || items[0])?.focus();
    });
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    const items = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : -1;
    if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
  }
</script>

<svelte:window onpointerdown={event => { if (expanded && !root.contains(event.target as Node)) close(); }} />
<div class="view-switcher" bind:this={root}>
  <button class="interaction-button" aria-label="io_lock" aria-pressed={!!interaction?.io_lock}
    disabled={!permissions.io_lock || !interaction?.configured || !interaction?.capabilities?.io_lock}
    title={`io_lock (F3)${permissions.io_lock ? interaction?.capabilities?.io_lock
      ? '' : ' — renderer binding unavailable' : ' — not allowed by this node'}`}
    onclick={()=>oninteraction?.('io_lock')}>IO</button>
  <button class="render-button" bind:this={trigger} aria-label="Render" aria-haspopup="menu" aria-expanded={expanded}
    title={current?.label} onclick={() => expanded ? close() : focusView()}
    onkeydown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusView(event.key === 'ArrowUp'); } }}>
    Render <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
  </button>
  {#if expanded}
    <div class="render-options" role="menu" tabindex="-1" aria-label="Render views" onkeydown={key}>
      {#each views as node (node.id)}
        <button role="menuitemradio" aria-checked={node.id === selected} tabindex="-1" onclick={() => { close(true); onchange(node.id); }}>
          <span class="check" aria-hidden="true">{node.id === selected ? '✓' : ''}</span><span>{node.label}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if failure}<span class="view-error" role="alert">{current.label}: {failure}</span>{/if}
</div>

<style>
  .view-switcher { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
  .interaction-button { display: grid; place-items: center; width: 28px; height: 28px; padding: 4px; background: transparent; border-color: var(--line-strong); border-radius: 7px; color: var(--muted); font-weight: 400; }
  .interaction-button[aria-pressed=true] { background: var(--raised); color: var(--accent); font-weight: 700; }
  .render-button { display: inline-flex; align-items: center; gap: 7px; padding: 6px 9px; background: transparent; border-color: var(--line-strong); border-radius: 7px; font-size: 12px; }
  .render-button svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }
  .render-options { position: absolute; z-index: 30; top: calc(100% + 5px); left: 0; width: max-content; min-width: 160px; max-width: min(360px, calc(100vw - 48px)); max-height: 50dvh; overflow: auto; padding: 4px; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 8px; box-shadow: 0 8px 24px #0003; }
  .render-options button { display: flex; align-items: baseline; gap: 7px; width: 100%; padding: 7px 9px; border: 0; background: transparent; text-align: left; font-size: 12px; }
  .render-options button:hover, .render-options button:focus-visible { background: var(--raised); }
  .view-error { color: var(--danger); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
  .check { flex: none; width: 12px; color: var(--accent); }
</style>
