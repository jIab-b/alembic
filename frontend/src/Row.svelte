<script lang="ts">
  // Node labels open their manifest entry; a separate disclosure exposes source files.
  let {depth = 0, folder = false, node = false, expanded = false, active = false, label, title = label, onclick, onexpand, oncontextmenu}: {
    depth?: number; folder?: boolean; node?: boolean; expanded?: boolean; active?: boolean; label: string; title?: string; onclick: () => void;
    onexpand?: () => void;
    oncontextmenu?: (event: MouseEvent) => void
  } = $props();
  const kind = $derived(/\.(?:i3d|i2d|audio)$/i.test(label) ? label.split('.').pop()?.toLowerCase() : '');
</script>
{#snippet symbol()}
  {#if kind === 'i3d'}<svg class="icon node-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="m10 2 7 4v8l-7 4-7-4V6zm0 0v8m7-4-7 4-7-4m7 4v8" /></svg>
  {:else if kind === 'i2d'}<svg class="icon node-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M5 3h12v12H5zM2 6v12h12M6 12l3-4 3 3 2-2 2 3" /><circle cx="13" cy="6" r=".8" /></svg>
  {:else if kind === 'audio'}<svg class="icon node-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M2 8v4m4-7v10m4-13v16m4-13v10m4-7v4" /></svg>
  {:else if folder}<svg class="icon folder" aria-hidden="true" viewBox="0 0 20 18"><path opacity=".7" d="M1 4a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8H1z" /><path d="M1 6h18v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" /><path class="folder-shine" d="M2 6.5h16" /></svg>
  {:else if label.endsWith('.canvas')}<svg class="icon doc" aria-hidden="true" viewBox="0 0 16 16" style="color:var(--accent)"><path d="m8 1.5 6 3.2v6.6l-6 3.2-6-3.2V4.7zm0 0V8m6-3.3L8 8 2 4.7M8 8v6.5" /></svg>
  {:else}<svg class="icon doc" aria-hidden="true" viewBox="0 0 16 16"><path d="M4 1.5h5.2l3.3 3.3v9.7H4z M9 1.5v3.5h3.5" /></svg>{/if}
{/snippet}
{#if node && onexpand}
  <div class="row node-row" class:active style:--depth={depth}>
    <button class="disclosure" aria-label={`${expanded ? 'Collapse' : 'Expand'} sources for ${label}`} aria-expanded={!!expanded}
      onclick={onexpand} {oncontextmenu}><svg class="twist" class:open={expanded} aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" /></svg></button>
    <button class="node-open" {title} {onclick} {oncontextmenu}>{@render symbol()}<span>{label}</span></button>
  </div>
{:else}
<button class="row" class:active style:--depth={depth} {title} {onclick} {oncontextmenu}>
  <svg class="twist" class:open={expanded} class:hidden={!folder} aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" /></svg>
  {@render symbol()}
  <span>{label}</span>
</button>
{/if}

<style>
  .node-row > button { display: flex; align-items: center; align-self: stretch; border: 0; border-radius: 3px; background: transparent; padding: 0; }
  .disclosure { flex: none; justify-content: center; width: 18px; margin: 0 -3px; }
  .node-open { flex: 1; gap: 6px; text-align: left; }
  .node-row > button:hover { background: transparent; }
  .node-row > button:focus-visible { outline-offset: -2px; }
  .node-icon { color: var(--accent); fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
  .active .node-icon { color: white; }
</style>
