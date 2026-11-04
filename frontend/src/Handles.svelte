<script lang="ts">
  // Selection volumes on a scene. Dragging any volume moves it; a click just makes it the active one (picks only
  // select), and a right click without a drag opens its menu (onmenu, at client coordinates). The active sphere or box has drag dots on its outline as the camera sees it, along the world axes
  // nearest the screen's right (R) and up (U): a side dot stretches one axis with the opposite side staying put
  // (a sphere becomes an oval); a corner dot stretches both, or on a sphere scales it whole. Shift works along
  // the depth axis instead. Volumes stay axis-aligned.
  import {onMount} from 'svelte';
  import {half} from './gltf.js';
  import type {Selection} from './history';
  type ViewFrame = {right: number[]; up: number[]; forward: number[]; scale: number};
  type Camera = {project(point: number[]): number[] | null; axes(): {right: number[]; up: number[]; forward: number[]}; dragFrame(point: number[]): ViewFrame};
  type Frame = {R: number; U: number; D: number; sign: number[]; px: number[][]; view: ViewFrame};
  type Drag = {start: Selection; x: number; y: number; i: number; j: number; frame: Frame; button: number; pointer: number};
  let {viewer, volumes, active, enabled, onselect, onchange, onmenu, ondelete}: {viewer: Camera; volumes: Selection[]; active: string; enabled: boolean;
    onselect: (id: string) => void; onchange: (next: Selection, done: boolean) => void; onmenu: (id: string, x: number, y: number) => void; ondelete?: (id: string) => void} = $props();
  const PLACES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const current = $derived(enabled ? volumes.find(v => v.id === active && v.shape !== 'pick') : undefined);
  const solid = (v: Selection) => v.shape === 'pick' ? {...v, shape: 'sphere' as const} : v;  // a pick draws as a small sphere
  let root: HTMLDivElement, dots = $state<{x: number; y: number; i: number; j: number; cursor: string}[]>([]), drag: Drag | null = null;

  // Which world axes the screen shows as right and up, and screen pixels per world unit along each axis.
  function frameAt(center: number[], size: number): Frame | null {
    const {right, up, forward} = viewer.axes(), at = viewer.project(center);
    if (!at) return null;
    const R = [0, 1, 2].reduce((a, k) => Math.abs(right[k]) > Math.abs(right[a]) ? k : a, 0);
    const U = [0, 1, 2].filter(k => k !== R).reduce((a, k) => Math.abs(up[k]) > Math.abs(up[a]) ? k : a), D = 3 - R - U;
    const px = [0, 1, 2].map(k => { const p = viewer.project(center.map((c, n) => n === k ? c + size : c));
      return p ? [(p[0] - at[0]) / size, (p[1] - at[1]) / size] : [0, 0]; });
    return {R, U, D, sign: [Math.sign(right[R]) || 1, Math.sign(up[U]) || 1, Math.sign(forward[D]) || 1], px, view: viewer.dragFrame(center)};
  }
  // Whether a screen point falls on a volume: inside its projected bounds (a sphere: the ellipse inside them).
  function hits(volume: Selection, x: number, y: number) {
    const v = solid(volume), h = half(v), spots = [...Array(8)].flatMap((_, i) =>
      viewer.project(v.center!.map((c, k) => c + (i >> k & 1 ? h[k] : -h[k]))) ?? []);
    if (spots.length < 16) return false;
    const xs = spots.filter((_, n) => n % 2 === 0), ys = spots.filter((_, n) => n % 2 === 1);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (v.shape === 'box') return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    return ((x - (x0 + x1) / 2) / ((x1 - x0) / 2 || 1)) ** 2 + ((y - (y0 + y1) / 2) / ((y1 - y0) / 2 || 1)) ** 2 <= 1;
  }
  function place() {
    if (!current) { dots = []; return; }
    const center = current.center!, h = half(current), frame = frameAt(center, Math.max(...h) || 1), at = viewer.project(center);
    if (!frame || !at) { dots = []; return; }
    dots = PLACES.flatMap(([i, j]) => {
      const k = current.shape === 'sphere' && i && j ? Math.SQRT1_2 : 1, p = [...center];
      p[frame.R] += i * frame.sign[0] * h[frame.R] * k; p[frame.U] += j * frame.sign[1] * h[frame.U] * k;
      const spot = viewer.project(p);
      if (!spot) return [];
      const cursor = !i ? 'ns-resize' : !j ? 'ew-resize' : (spot[0] - at[0]) * (spot[1] - at[1]) > 0 ? 'nwse-resize' : 'nesw-resize';
      return [{x: spot[0], y: spot[1], i, j, cursor}];
    });
  }
  function stretch({start, i, j, frame}: Drag, dx: number, dy: number, depth: boolean): Selection {
    const next = structuredClone(start), h = [...half(start)], c = next.center!, least = Math.max(...h) * 0.02 || 1e-3;
    const along = (v: number[]) => (dx * v[0] + dy * v[1]) / (v[0] ** 2 + v[1] ** 2 || 1);  // world units along that axis
    const pixel = 1 / (Math.hypot(...frame.px[frame.U]) || 1);  // world units per pixel at the volume
    if (!i && !j) {
      // Translate in the camera plane so the grabbed point follows the pointer exactly.
      // Independently projecting two world axes introduced cross-axis drift in oblique views.
      const {right, up, forward, scale} = frame.view;
      for (let k = 0; k < 3; k++) c[k] += scale * (depth ? -dy * forward[k] : dx * right[k] - dy * up[k]);
      return next;
    }
    if (depth) h[frame.D] = Math.max(least, h[frame.D] - dy * pixel / 2);
    else if (start.shape === 'sphere' && i && j) {
      const out = (along(frame.px[frame.R]) * i * frame.sign[0] + along(frame.px[frame.U]) * j * frame.sign[1]) / 2;
      const was = (h[frame.R] + h[frame.U]) / 2, k = Math.max(least / was, (was + out * Math.SQRT2) / was);
      h.forEach((v, n) => h[n] = v * k);
    } else for (const [axis, side, s] of [[frame.R, i, frame.sign[0]], [frame.U, j, frame.sign[1]]]) {
      if (!side) continue;
      const out = along(frame.px[axis]) * side * s, wider = Math.max(least, h[axis] + out / 2);
      c[axis] += side * s * (wider - h[axis]); h[axis] = wider;
    }
    if (next.shape === 'sphere') {
      next.radius = Math.max(...h);
      if (h.every(v => Math.abs(v - h[0]) <= h[0] * 1e-9)) delete next.radii; else next.radii = h;
    } else next.size = h.map(v => v * 2);
    return next;
  }
  function begin(event: PointerEvent, i: number, j: number, target: Selection) {
    const frame = frameAt(target.center!, Math.max(...half(solid(target))) || 1);
    event.preventDefault(); event.stopPropagation();
    if (!frame) return;
    root.focus({preventScroll:true});
    drag = {start: structuredClone($state.snapshot(target)), x: event.clientX, y: event.clientY, i, j, frame, button: event.button, pointer:event.pointerId};
    root.setPointerCapture(event.pointerId);
    addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
  }
  function move(event: PointerEvent) {
    if (drag) onchange(stretch(drag, event.clientX - drag.x, event.clientY - drag.y, event.shiftKey), false);
  }
  function end(event: PointerEvent) {
    removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    if (!drag) return;
    if(root.hasPointerCapture(drag.pointer))root.releasePointerCapture(drag.pointer);
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3, {start, button} = drag;
    onchange(moved ? stretch(drag, event.clientX - drag.x, event.clientY - drag.y, event.shiftKey) : start, moved);
    drag = null;
    if (!moved && button === 2) onmenu(start.id, event.clientX, event.clientY);
  }
  $effect(() => {
    if (!current) { if (dots.length) dots = []; return; }
    let frame = requestAnimationFrame(function tick() { place(); frame = requestAnimationFrame(tick); });
    return () => cancelAnimationFrame(frame);
  });
  onMount(() => {
    // A press on a volume belongs to it (active one first, then the newest); anywhere else it reaches the canvas.
    const host = root.parentElement!, grab = (event: PointerEvent) => {
      // Only scene presses can grab a volume; menus, prompt cards and area handles own their clicks.
      if (!enabled || (event.button !== 0 && event.button !== 2) || !(event.target as Element).closest('.scene,.native-hit')) return;
      const box = root.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
      const hit = [...volumes].reverse().sort((a, b) => Number(b.id === active) - Number(a.id === active)).find(v => hits(v, x, y));
      if (!hit) return;
      if (hit.id !== active) onselect(hit.id);
      if (hit.shape === 'pick') {
        root.focus({preventScroll:true});
        event.preventDefault(); event.stopPropagation();
        if (event.button === 2) onmenu(hit.id, event.clientX, event.clientY);
      }
      else begin(event, 0, 0, hit);
    };
    host.addEventListener('pointerdown', grab, true);
    return () => { host.removeEventListener('pointerdown', grab, true); removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); };
  });
</script>

<div class="handles" bind:this={root} tabindex="-1" oncontextmenu={event => event.preventDefault()} role="presentation">
  {#if current}{#each dots as dot (`${dot.i},${dot.j}`)}
    <span class="dot" class:corner={dot.i && dot.j} style:left="{dot.x}px" style:top="{dot.y}px" style:cursor={dot.cursor}
      role="presentation" onpointerdown={event => { if (event.button === 0 && current) begin(event, dot.i, dot.j, current); }}></span>
  {/each}{/if}
  {#if current && ondelete && dots.length}
    <button class="delete-volume" aria-label="Delete highlight" title="Delete highlight"
      style:left="{Math.max(...dots.map(dot => dot.x)) + 10}px" style:top="{Math.min(...dots.map(dot => dot.y)) - 10}px"
      onpointerdown={event => event.stopPropagation()} onclick={() => ondelete?.(current!.id)}>
      <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
    </button>
  {/if}
</div>

<style>
  .handles { position: absolute; inset: 0; pointer-events: none; }
  .handles:focus { outline:none; }
  .delete-volume { position: absolute; pointer-events: auto; display: grid; place-items: center; width: 23px; height: 23px; padding: 3px; border-radius: 50%; background: var(--raised); color: var(--accent); border: 1px solid var(--line-strong); }
  .delete-volume:hover { color: var(--danger); }
  .delete-volume svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.3; }
</style>
