<script lang="ts">
  import {onMount, tick} from 'svelte';
  import {captureGraph} from './shadow.js';
  let {path, changes, graph, selected, inspectedRun, thumbnails, liveHash, onpreview, oninspect}: {
    path: string; changes: any[]; graph: any; selected: string; inspectedRun: string;
    thumbnails: Record<string, string>; liveHash: string;
    onpreview: (commit: string) => void; oninspect: (run: string) => void
  } = $props();
  let viewport: HTMLDivElement, width = $state(0), height = $state(0), related = $state(false);
  let zoom = $state(1), pan = $state({x: 0, y: 0}), touched = $state(false);
  let positions = $state<Record<string, {x: number; y: number}>>({});
  let drag: {id?: string; x: number; y: number; from: {x: number; y: number}} | null = null;
  const layout = $derived(captureGraph(path, changes, graph, related));
  const nodes = $derived(layout.nodes.map((node: any) => ({...node, ...positions[node.id]})));
  const byId = $derived(new Map(nodes.map((node: any) => [node.id, node])));
  // Only mount cards near the viewport. Their previews are cached images, not WebGL renderers.
  const visible = $derived(nodes.filter((node: any) => node.x * zoom + pan.x < width + 120 &&
    (node.x + node.width) * zoom + pan.x > -120 && node.y * zoom + pan.y < height + 120 &&
    (node.y + node.height) * zoom + pan.y > -120));
  const visibleIds = $derived(new Set(visible.map((node: any) => node.id)));
  const wires = $derived(layout.edges.filter((edge: any) => visibleIds.has(edge.from) || visibleIds.has(edge.to)));
  function fit(initial = false) {
    if (!width || !height || !nodes.length) return;
    const left = Math.min(...nodes.map((node: any) => node.x)) - 36, top = Math.min(...nodes.map((node: any) => node.y)) - 36;
    const right = Math.max(...nodes.map((node: any) => node.x + node.width)) + 36;
    const bottom = Math.max(...nodes.map((node: any) => node.y + node.height)) + 36;
    let next = Math.min(1, width / (right - left), height / (bottom - top));
    if (initial && next < .5) {
      next = .8;
      const focus = nodes.find((node: any) => node.commit === selected) || nodes.at(-1);
      pan = {x: width / 2 - (focus.x + focus.width / 2) * next, y: height / 2 - (focus.y + focus.height / 2) * next};
    } else pan = {x: (width - (right - left) * next) / 2 - left * next, y: (height - (bottom - top) * next) / 2 - top * next};
    zoom = next;
  }
  $effect(() => { if (!touched) fit(true); });
  function zoomAt(factor: number, x = width / 2, y = height / 2) {
    touched = true;
    const next = Math.min(2.5, Math.max(.02, zoom * factor));
    pan = {x: x - (x - pan.x) * next / zoom, y: y - (y - pan.y) * next / zoom}; zoom = next;
  }
  function start(event: PointerEvent, node?: any) {
    if (event.button !== 0 && event.button !== 1) return;
    if (!node && (event.target as Element).closest('.graph-node,button,input')) return;
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    touched = true; drag = {id: node?.id, x: event.clientX, y: event.clientY, from: node ? {x: node.x, y: node.y} : {...pan}};
  }
  function move(event: PointerEvent) {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (drag.id) positions = {...positions, [drag.id]: {x: drag.from.x + dx / zoom, y: drag.from.y + dy / zoom}};
    else pan = {x: drag.from.x + dx, y: drag.from.y + dy};
  }
  function nodeKey(event: KeyboardEvent, node: any) {
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault(); event.stopPropagation(); touched = true;
    positions = {...positions, [node.id]: {x: node.x + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0),
      y: node.y + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0)}};
  }
  function wire(edge: any) {
    const a: any = byId.get(edge.from), b: any = byId.get(edge.to);
    const x = a.x + a.width, y = a.y + 48, tx = b.x, ty = b.y + 48;
    const bend = Math.max(45, Math.abs(tx - x) * .45);
    return `M ${x} ${y} C ${x + bend} ${y}, ${tx - bend} ${ty}, ${tx} ${ty}`;
  }
  function stamp(value: string | number) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
  }
  onMount(() => {
    const observer = new ResizeObserver(() => { width = viewport.clientWidth; height = viewport.clientHeight; });
    observer.observe(viewport);
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const box = viewport.getBoundingClientRect();
      zoomAt(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .003), event.clientX - box.left, event.clientY - box.top);
    };
    viewport.addEventListener('wheel', wheel, {passive: false});
    return () => { observer.disconnect(); viewport.removeEventListener('wheel', wheel); };
  });
</script>

<div class="graph-panel">
  <div class="graph-toolbar">
    <span>{changes.length} captures</span>
    <label><input type="checkbox" bind:checked={related} onchange={async () => { touched = true; await tick(); fit(); }} /> Related runs</label>
    <div class="wire-legend" aria-label="Graph connection types"><span>capture</span><span class="prior">prior state</span><span class="working">working file</span></div>
    <div class="zoom-controls"><button aria-label="Zoom out" onclick={() => zoomAt(1 / 1.2)}>−</button><span>{Math.round(zoom * 100)}%</span>
      <button aria-label="Zoom in" onclick={() => zoomAt(1.2)}>+</button><button onclick={() => { touched = true; fit(); }}>Fit</button></div>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="graph-viewport" bind:this={viewport} role="application" aria-label="Shadow graph" tabindex="0"
    style:background-size="{24 * zoom}px {24 * zoom}px" style:background-position="{pan.x}px {pan.y}px"
    onpointerdown={event => start(event)} onpointermove={move} onpointerup={() => drag = null} onpointercancel={() => drag = null}
    onkeydown={event => {
      if (event.target !== viewport) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(1.2); }
      else if (event.key === '-') { event.preventDefault(); zoomAt(1 / 1.2); }
      else if (event.key === '0') { event.preventDefault(); touched = true; fit(); }
    }}>
    <div class="graph-world" style:transform="translate({pan.x}px, {pan.y}px) scale({zoom})">
      <svg class="wires" aria-label="Recorded graph connections"><g>
        {#each wires as edge (edge.id)}<path d={wire(edge)} class:prior={edge.kind === 'prior'} class:working={edge.kind === 'live'} class:related={edge.kind === 'related'}><title>{edge.label}</title></path>{/each}
      </g></svg>
      {#each visible as node (node.id)}
        <div class="graph-node" class:run={node.kind === 'run'} class:live={node.kind === 'live'}
          class:dirty={node.kind === 'live' && !!liveHash && !!changes[0]?.hash && liveHash !== changes[0].hash}
          class:chosen={node.kind === 'run' ? inspectedRun === node.run : !inspectedRun && selected === node.commit}
          style:left="{node.x}px" style:top="{node.y}px" style:width="{node.width}px" style:height="{node.height}px">
          <button class="node-heading" aria-label={`Move ${node.kind === 'run' ? 'run' : 'version'} node`} title="Drag to arrange · Arrow keys to move"
            onpointerdown={event => start(event, node)} onkeydown={event => nodeKey(event, node)}>
            <span>{node.kind === 'run' ? node.recordKind === 'edit' ? 'FILE EDIT' : node.recordKind === 'turn' ? 'PROMPT TURN' : 'RECORDED RUN' : node.kind === 'live' ? 'LIVE FILE' : 'FILE SNAPSHOT'}</span>
            <span>{node.kind === 'run' && node.exit !== null && node.exit !== undefined ? `exit ${node.exit}` : '◇'}</span>
          </button>
          <span class="port input" title="Input"></span><span class="port output" title="Output"></span>
          {#if node.kind === 'run'}
            <button class="run-content" aria-label={`Inspect run: ${node.title}`} onclick={() => node.run ? oninspect(node.run) : onpreview(node.commit)}>
              <strong>{node.title}</strong><small>{node.actor || 'Unknown actor'} · {stamp(node.at)}</small>
            </button>
          {:else}
            {@const thumbnail = thumbnails[node.kind === 'live' ? liveHash : node.hash]}
            <button class="node-preview" aria-label={node.kind === 'live' ? 'Preview live file' : `Preview ${node.title}`} onclick={() => onpreview(node.commit)}>
              <strong>{node.title}</strong>
              {#if thumbnail}<img src={thumbnail} alt={`${node.title} snapshot preview`} />
              {:else}<span class="unrendered"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 42 15v19L24 44 6 34V15Z M6 15l18 10 18-10 M24 25v19" /></svg><small>Click to render</small></span>{/if}
              <code>{node.kind === 'live' ? liveHash && changes[0]?.hash && liveHash !== changes[0].hash ? 'Uncaptured changes' : 'Current working state' : node.change === 'removed' || node.change === 'deleted' ? 'Deleted' : stamp(node.at)}</code>
            </button>
          {/if}
        </div>
      {/each}
    </div>
    <div class="graph-help">Drag background to pan · Scroll to zoom · Click a version to render</div>
  </div>
</div>

<style>
  .graph-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--canvas); }
  .graph-toolbar { display: flex; align-items: center; gap: 14px; min-height: 42px; padding: 6px 12px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 11px; }
  label { display: flex; gap: 5px; align-items: center; white-space: nowrap; }
  input { accent-color: var(--accent); }
  .wire-legend { display: flex; gap: 10px; font-size: 10px; }
  .wire-legend span { display: flex; gap: 4px; align-items: center; white-space: nowrap; }
  .wire-legend span::before { content: ''; width: 12px; border-top: 2px solid #90a7bf; }
  .wire-legend .prior::before { border-color: #c89a6c; }
  .wire-legend .working::before { border-color: #78bbaa; border-top-style: dashed; }
  .zoom-controls { display: flex; gap: 5px; align-items: center; margin-left: auto; }
  .zoom-controls span { min-width: 36px; text-align: center; }
  .zoom-controls button { padding: 3px 8px; }
  .graph-viewport { position: relative; flex: 1; min-height: 0; overflow: hidden; background-image: radial-gradient(circle, var(--line-strong) 1px, transparent 1px); cursor: grab; touch-action: none; }
  .graph-viewport:active { cursor: grabbing; }
  .graph-world { position: absolute; inset: 0; transform-origin: 0 0; overflow: visible; }
  .wires { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
  .wires path { fill: none; stroke: #90a7bf; stroke-width: 2.5; opacity: .7; }
  .wires .prior { stroke: #c89a6c; }
  .wires .working { stroke: #78bbaa; stroke-dasharray: 6 5; }
  .wires .related { stroke: #a18cb9; stroke-dasharray: 4 5; opacity: .4; }
  .graph-node { position: absolute; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 9px; box-shadow: 0 4px 12px #0003; overflow: visible; display: flex; flex-direction: column; }
  .graph-node.chosen { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 4px 12px #0003; }
  .node-heading { display: flex; justify-content: space-between; padding: 8px 11px; color: #dbe7f3; background: #3b526a; border: 0; border-radius: 8px 8px 0 0; font-size: 10px; letter-spacing: .07em; cursor: move; }
  .run .node-heading { background: #534760; }
  .live .node-heading { background: #3c6059; }
  .live.dirty .node-heading { background: #68583e; }
  .port { position: absolute; top: 43px; width: 10px; height: 10px; border: 2px solid var(--panel); background: #90a7bf; border-radius: 50%; z-index: 1; }
  .port.input { left: -5px; } .port.output { right: -5px; }
  .run .port { background: #b5a1cb; } .live .port { background: #80b6aa; }
  .run-content, .node-preview { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 5px; padding: 11px; border: 0; background: transparent; border-radius: 0 0 8px 8px; text-align: left; }
  strong { font-size: 12px; line-height: 1.5; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  small, code { color: var(--muted); font-size: 10px; }
  .node-preview img { width: 100%; flex: 1; min-height: 0; object-fit: contain; border-radius: 4px; background: var(--canvas); }
  .unrendered { display: grid; flex: 1; place-content: center; justify-items: center; gap: 7px; width: 100%; background: var(--canvas); border-radius: 4px; }
  .unrendered svg { width: 43px; height: 43px; fill: none; stroke: var(--muted); stroke-width: 1; opacity: .45; }
  .graph-help { position: absolute; left: 12px; bottom: 12px; padding: 5px 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; color: var(--muted); font-size: 10px; pointer-events: none; }
  @media (max-width: 1100px) { .wire-legend { display: none; } }
</style>
