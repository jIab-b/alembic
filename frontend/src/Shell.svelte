<script lang="ts">
  import {onMount, type Snippet} from 'svelte';
  let {theme, popup, toggleTheme, files, agent, tabs, promptMenu, chatReveal = 0, minimal = false, children}: {theme: string; popup: string | null;
    toggleTheme: () => void; files: Snippet; agent: Snippet<[boolean, () => void]>; tabs: Snippet;
    promptMenu: Snippet<[boolean]>; chatReveal?: number; minimal?: boolean; children: Snippet} = $props();
  const limits = {files: [254, 180, 520], agent: [420, 280, 760]} as const;
  type Edge = keyof typeof limits;
  let widths = $state({files: 254, agent: 420}), open = $state({files: true, agent: true});
  $effect(() => { if (chatReveal) open.agent = true; });
  let shell: HTMLDivElement, width = $state(innerWidth);
  let drag = $state<{edge: Edge; x: number; from: number; other: number; constrained: boolean} | null>(null);
  const clamp = (edge: Edge, value: number) => Math.max(limits[edge][1], Math.min(limits[edge][2], value));
  const fitted = $derived.by(() => {
    let files = open.files ? widths.files : 58, agent = minimal ? 0 : open.agent ? widths.agent : 58;
    const fmin = open.files ? 180 : 58, amin = minimal ? 0 : open.agent ? 280 : 58;
    const canvas = Math.min(320, Math.max(120, width - fmin - amin));
    const excess = Math.max(0, files + agent + canvas - width), room = files - fmin + agent - amin;
    const cut = Math.min(files - fmin, excess * (files - fmin) / (room || 1));
    files -= cut; agent -= Math.min(agent - amin, excess - cut);
    return {files, agent, canvas};
  });
  function save() { try { localStorage.setItem('alembic-layout', JSON.stringify({widths, open})); } catch {} }
  function toggle(edge: Edge) { open[edge] = !open[edge]; save(); }
  function reset(edge: Edge) { widths[edge] = limits[edge][0]; save(); }
  function start(edge: Edge, event: PointerEvent) {
    if (event.button !== 0 || !open[edge]) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).focus();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const other = edge === 'files' ? 'agent' : 'files';
    drag = {edge, x: event.clientX, from: fitted[edge], other: fitted[other],
      constrained: open[other] && fitted.files + fitted.agent + fitted.canvas >= width - 1};
  }
  function move(event: PointerEvent) {
    if (!drag) return;
    const {edge, x, from, other, constrained} = drag, opposite = edge === 'files' ? 'agent' : 'files';
    const next = clamp(edge, from + (event.clientX - x) * (edge === 'files' ? 1 : -1));
    if (constrained) {
      widths[opposite] = clamp(opposite, other - (next - from));
      widths[edge] = from + other - widths[opposite];
    } else widths[edge] = next;
  }
  function end() { if (drag) { drag = null; save(); } }
  function key(edge: Edge, event: KeyboardEvent) {
    if (event.key === 'Home') { event.preventDefault(); reset(edge); }
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    widths[edge] = clamp(edge, fitted[edge] + (event.shiftKey ? 30 : 10) * (event.key === 'ArrowRight' ? 1 : -1) * (edge === 'files' ? 1 : -1));
    save();
  }
  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('alembic-layout') ?? '{}');
      for (const edge of ['files', 'agent'] as Edge[]) {
        if (Number.isFinite(saved.widths?.[edge])) widths[edge] = clamp(edge, saved.widths[edge]);
        if (typeof saved.open?.[edge] === 'boolean') open[edge] = saved.open[edge];
      }
    } catch {}
    const observer = new ResizeObserver(() => { width = shell.clientWidth; });
    observer.observe(shell);
    return () => observer.disconnect();
  });
</script>

<div class="shell" class:minimal class:popup class:files-closed={!open.files} class:agent-closed={!open.agent} class:dragging={!!drag}
  data-theme={theme} bind:this={shell} style={`--files-width:${fitted.files}px;--agent-width:${fitted.agent}px;--canvas-min:${fitted.canvas}px`}>
  {#if !popup}
    <aside class="files panel" aria-label="Folder panel">
      <header class="brand">
        <button class="theme-toggle" onclick={toggleTheme} aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>{theme === 'dark' ? '☀' : '☾'}</button>
        {#if !minimal}{@render promptMenu(!open.files)}{/if}
        <button class="collapse" aria-label={open.files ? 'Collapse folder' : 'Open folder'} aria-expanded={open.files}
          onclick={() => toggle('files')}>{open.files ? '‹' : '›'}</button>
      </header>
      {#if open.files}<nav class="tree" aria-label="Files">{@render files()}</nav>{/if}
    </aside>
    {#each minimal ? ['files'] : ['files', 'agent'] as name}
      {@const edge = name as Edge}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="resizer" class:active={drag?.edge === edge} class:disabled={!open[edge]} style:grid-column={edge === 'files' ? '2' : '4'}
        role="separator" aria-orientation="vertical" aria-label={`Resize ${edge === 'files' ? 'folder' : 'agent'} panel`}
        aria-valuemin={limits[edge][1]} aria-valuemax={limits[edge][2]} aria-valuenow={Math.round(open[edge] ? fitted[edge] : widths[edge])} aria-disabled={!open[edge]}
        tabindex={open[edge] ? 0 : -1} title="Resize"
        onpointerdown={event => start(edge, event)} onpointermove={move} onpointerup={end} onpointercancel={end}
        onlostpointercapture={end} onkeydown={event => key(edge, event)} ondblclick={() => reset(edge)}></div>
    {/each}
    {#if !minimal}<aside class="agent panel" aria-label="Agent">{@render agent(open.agent, () => toggle('agent'))}</aside>{/if}
  {/if}
  <main aria-label="Canvas">
    {#if !popup}<header class="canvas-header">
      {@render tabs()}
    </header>{/if}
    <div id="canvas-surface" class="canvas-surface" role="tabpanel" aria-label="Canvas content">{@render children()}</div>
  </main>
</div>

<style>
  .shell.minimal { grid-template-columns: var(--files-width) 0 minmax(120px, 1fr); }
  @media (max-width: 600px) { .shell.minimal { grid-template: auto minmax(120px, 1fr) / minmax(0, 1fr); } }
  .canvas-header { gap: 0; padding: 0; flex-shrink: 0; height: 38px; min-height: 38px; }
  .canvas-surface { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; }
</style>
