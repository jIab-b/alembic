<script lang="ts">
  // 2D areas drawn over whatever the viewer shows: a scene, an embedded app, an image. With the area tool armed,
  // a drag on an area moves it and a drag elsewhere draws a new one (then the tool disarms). Over a scene
  // (grab), areas can always be dragged; over an app they let clicks through, so the app stays usable. The
  // active area keeps drag dots: sides stretch one way, corners both; a right click without a drag opens its menu
  // (onmenu, at client coordinates). Areas are [x, y, width, height] in fractions of the viewer.
  import type {Selection} from './history';
  type Drag = {id: string; start: number[]; x: number; y: number; i: number; j: number; box: DOMRect; button: number};
  let {areas, active, armed, grab, ondraw, onselect, onchange, onmenu}: {areas: Selection[]; active: string; armed: boolean; grab: boolean;
    ondraw: (area: number[]) => void; onselect: (id: string) => void; onchange: (id: string, area: number[], done: boolean) => void;
    onmenu: (id: string, x: number, y: number) => void} = $props();
  const PLACES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const current = $derived(areas.find(a => a.id === active));
  let root: HTMLDivElement, sketch = $state<number[] | null>(null), drag: Drag | null = null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const spot = (event: PointerEvent, box: DOMRect) => [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
  function rect(a: number[], b: number[]) {
    const x = clamp(Math.min(a[0], b[0])), y = clamp(Math.min(a[1], b[1]));
    return [x, y, clamp(Math.max(a[0], b[0])) - x, clamp(Math.max(a[1], b[1])) - y];
  }
  // id '' draws a new area; i = j = 0 moves one; otherwise the dragged edges follow the pointer.
  function shaped(d: Drag, event: PointerEvent) {
    const [px, py] = spot(event, d.box), dx = px - d.x, dy = py - d.y, [x, y, w, h] = d.start;
    if (!d.id) return rect([d.x, d.y], [px, py]);
    if (!d.i && !d.j) return [Math.min(1 - w, Math.max(0, x + dx)), Math.min(1 - h, Math.max(0, y + dy)), w, h];
    return rect([x + (d.i < 0 ? dx : 0), y + (d.j < 0 ? dy : 0)], [x + w + (d.i > 0 ? dx : 0), y + h + (d.j > 0 ? dy : 0)]);
  }
  function begin(event: PointerEvent, id: string, i: number, j: number) {
    const box = root.getBoundingClientRect(), [x, y] = spot(event, box);
    event.preventDefault(); event.stopPropagation();
    drag = {id, start: areas.find(a => a.id === id)?.area ?? [x, y, 0, 0], x, y, i, j, box, button: event.button};
    addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
  }
  function move(event: PointerEvent) {
    if (!drag) return;
    if (drag.id) onchange(drag.id, shaped(drag, event), false); else sketch = shaped(drag, event);
  }
  function end(event: PointerEvent) {
    removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    if (!drag) return;
    const area = shaped(drag, event), {id, box, start: drag0, button} = drag, moved = area.some((v, k) => v !== drag0[k]);
    drag = null; sketch = null;
    if (event.type === 'pointercancel') { if (id) onchange(id, drag0, true); return; }
    if (id) {
      onchange(id, area, moved);
      if (!moved) onmenu(id, event.clientX, event.clientY);
      return;  // selecting or moving an existing area must never create another one
    }
    if (area[2] * box.width > 6 && area[3] * box.height > 6) ondraw(area);
  }
  function press(event: PointerEvent) {
    const [x, y] = spot(event, root.getBoundingClientRect());
    const hit = [...areas].reverse().sort((a, b) => Number(b.id === active) - Number(a.id === active))
      .find(({area: [ax, ay, w, h] = []}) => x >= ax && x <= ax + w && y >= ay && y <= ay + h);
    if (hit) take(event, hit.id); else if (event.button === 0) begin(event, '', 0, 0);
  }
  function take(event: PointerEvent, id: string) {
    if (event.button !== 0 && event.button !== 2) return;
    if (id !== active) onselect(id);
    begin(event, id, 0, 0);
  }
  const place = (a: number[]) => `left:${a[0] * 100}%;top:${a[1] * 100}%;width:${a[2] * 100}%;height:${a[3] * 100}%`;
</script>

<div class="areas" class:armed bind:this={root} role="presentation" oncontextmenu={event => event.preventDefault()}
  onpointerdown={event => { if (armed) press(event); }}>
  {#each areas as area (area.id)}<div class="area" class:active={area.id === active} class:grab style={place(area.area!)} role="presentation"
    onpointerdown={event => { if (grab && !armed) take(event, area.id); }}>
    {#each ['top', 'right', 'bottom', 'left'] as edge}<span class="edge {edge}" role="presentation"
      onpointerdown={event => { if (!armed && !grab) take(event, area.id); }}></span>{/each}
  </div>{/each}
  {#if sketch}<div class="area active" style={place(sketch)}></div>{/if}
  {#if current?.area}{#each PLACES as [i, j]}
    {@const a = current.area}
    <span class="dot" class:corner={i && j} role="presentation" style:left="{(a[0] + (i + 1) / 2 * a[2]) * 100}%" style:top="{(a[1] + (j + 1) / 2 * a[3]) * 100}%"
      style:cursor={!i ? 'ns-resize' : !j ? 'ew-resize' : i * j > 0 ? 'nwse-resize' : 'nesw-resize'}
      onpointerdown={event => { if (event.button === 0) begin(event, current.id, i, j); }}></span>
  {/each}{/if}
</div>

<style>
  .areas { position: absolute; inset: 0; pointer-events: none; }
  .areas.armed { pointer-events: auto; cursor: var(--scene-cursor); }
  .area { position: absolute; border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 6%, transparent); pointer-events: none; }
  .area.active { border-color: color-mix(in srgb, var(--accent) 50%, transparent); background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .area.grab { pointer-events: auto; cursor: var(--scene-cursor); }
  .edge { position: absolute; pointer-events: auto; cursor: var(--scene-cursor); }
  .edge.top, .edge.bottom { left: 0; right: 0; height: 6px; }
  .edge.top { top: -3px; } .edge.bottom { bottom: -3px; }
  .edge.left, .edge.right { top: 0; bottom: 0; width: 6px; }
  .edge.left { left: -3px; } .edge.right { right: -3px; }
</style>
