<script lang="ts">
  // Project the selected scene point every frame; the card's wire stays attached while the camera moves.
  import {onMount} from 'svelte';
  let {x, y, ax, ay, projectAnchor, projectCard, highlight = '', phase, note, result = '', disabled, onsend, onclose, onmove, text = $bindable('')}: {x: number; y: number; ax: number; ay: number; highlight?: string;
    phase: 'edit' | 'brew' | 'done' | 'fail'; note: string; disabled: string;
    projectAnchor?: () => number[] | null; projectCard?: () => number[] | null; onsend: (text: string) => void; onclose: () => void; onmove: (x: number, y: number) => void; text?: string; result?: string} = $props();
  const id = $props.id();
  let field = $state<HTMLTextAreaElement>();
  let connector: SVGSVGElement, portElement: HTMLSpanElement;
  let anchor = $state<number[] | null>(null), port = $state([0, 0]), right = $state(false);
  let card = $state<number[] | null>(null);
  const wire = $derived.by(() => {
    if (!anchor) return '';
    const bend = Math.max(40, Math.abs(port[0] - anchor[0]) / 2), sign = right ? -1 : 1;
    return `M${anchor[0]} ${anchor[1]} C${anchor[0] + sign * bend} ${anchor[1]} ${port[0] - sign * bend} ${port[1]} ${port[0]} ${port[1]}`;
  });
  const send = () => { if (text.trim() && !disabled) onsend(text.trim()); };
  let drag: {startX: number; startY: number; x: number; y: number} | null = null;
  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {startX: event.clientX, startY: event.clientY, x: card?.[0] ?? x, y: card?.[1] ?? y};
  }
  function moveDrag(event: PointerEvent) {
    if (!drag) return;
    const box = connector.getBoundingClientRect(), scale = card?.[2] ?? 1;
    onmove(Math.max(0, Math.min(box.width - 264 * scale, drag.x + event.clientX - drag.startX)),
      Math.max(0, Math.min(box.height - 34 * scale, drag.y + event.clientY - drag.startY)));
  }
  onMount(() => {
    field?.focus();
    const update = () => {
      const nextCard = projectCard ? projectCard() : [x, y, 1];
      if (!nextCard) card = null;
      else if (!card || nextCard.some((value, index) => value !== card![index])) card = nextCard;
      const point = projectAnchor ? projectAnchor() : [ax, ay];
      if (!point || !point.every(Number.isFinite)) anchor = null;
      else if (!anchor || point[0] !== anchor[0] || point[1] !== anchor[1]) anchor = [...point];
      right = Boolean(point && card && point[0] > card[0] + 132 * card[2]);
      const box = connector.getBoundingClientRect(), dot = portElement.getBoundingClientRect();
      const next = [dot.left + dot.width / 2 - box.left, dot.top + dot.height / 2 - box.top];
      if (next[0] !== port[0] || next[1] !== port[1]) port = next;
    };
    update();
    let frame = requestAnimationFrame(function tick() { update(); frame = requestAnimationFrame(tick); });
    return () => cancelAnimationFrame(frame);
  });
</script>

<svg class="wire" bind:this={connector} aria-hidden="true">{#if anchor && card}<path d={wire} /><circle cx={anchor[0]} cy={anchor[1]} r="3.5" />{/if}</svg>
<div class="node" data-highlight={highlight} data-world-anchored={!!projectCard} style:left="{card?.[0] ?? x}px" style:top="{card?.[1] ?? y}px"
  style:transform="scale({card?.[2] ?? 1})" style:visibility={card ? 'visible' : 'hidden'} role="dialog" aria-label="Prompt">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={() => drag = null} onpointercancel={() => drag = null}>
    <span class="port" class:right bind:this={portElement}></span><b>Prompt</b>
    <button title="Close" aria-label="Close" onclick={onclose}><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
  </header>
  {#if phase === 'edit'}
    <textarea bind:this={field} bind:value={text} placeholder="Prompt" aria-label="Prompt"
      onkeydown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}></textarea>
    <footer>{#if disabled}<small class="hint">{disabled}</small>{/if}
      <button class="go" disabled={!text.trim() || Boolean(disabled)} onclick={send}>Send</button></footer>
  {:else}
    <div class="brew" class:still={phase !== 'brew'} class:fail={phase === 'fail'} role="status" aria-label={phase === 'brew' ? note || 'Prompt brewing' : note || phase}>
      <!-- An alembic flask over a flame; bubbles rise while the agent works. -->
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <defs><clipPath id={`${id}-bulb`}><circle cx="24" cy="29" r="10.6" /></clipPath></defs>
        <g clip-path={`url(#${id}-bulb)`}><rect class="liquid" x="10" y="27" width="28" height="16" /></g>
        <circle class="bubble" cx="21" cy="35" r="1.4" /><circle class="bubble b2" cx="26.5" cy="34" r="1.1" /><circle class="bubble b3" cx="24" cy="36" r=".9" />
        <path class="glass" d="M22 4h4M22.4 4v13.4A11.8 11.8 0 1 0 25.6 17.4V4" />
        <path class="vapor" d="M24 3c-2-2 2-3 0-5" />
        <path class="flame" d="M24 47c-3 0-4-2-2.5-4 .6 1 1.4 1 1.4-.4 0-1.2 1.6-2 1.6-2s0 1.4 1.2 2.3c1.3 1 .8 4.1-1.7 4.1z" />
      </svg>
      <span>{note || phase}</span>
    </div>
    {#if result}<div class="prompt-result" aria-label="Canvas prompt reply">{result}</div>{/if}
    {#if phase === 'fail'}<button class="go" disabled={Boolean(disabled)} onclick={send}>Retry</button>{/if}
  {/if}
</div>

<style>
  .wire { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 3; }
  .wire path { fill: none; stroke: #e28a67; stroke-width: 1.8; opacity: .9; }
  .wire circle { fill: #e28a67; }
  .node { position: absolute; z-index: 4; width: 264px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 0 10px 10px; background: var(--raised);
    border: 1px solid var(--line-strong); border-radius: 10px; box-shadow: var(--shadow); transform-origin: top left; }
  .node:focus-within { z-index: 6; }
  header { position: relative; display: flex; align-items: center; gap: 6px; height: 34px; margin: 0 -10px; padding: 0 6px 0 14px;
    border-bottom: 1px solid var(--line); border-radius: 10px 10px 0 0; background: color-mix(in srgb, var(--accent) 14%, var(--raised)); cursor: move; touch-action: none; }
  header b { flex: 1; font-size: 12px; font-weight: 600; }
  header button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: var(--muted); }
  header button:hover { color: var(--text); }
  header svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .port { position: absolute; left: -6px; top: 11px; width: 11px; height: 11px; border: 2px solid var(--accent); border-radius: 50%; background: var(--raised); }
  .port.right { left: auto; right: -6px; }
  textarea { width: 100%; min-height: 76px; resize: vertical; padding: 8px; color: var(--text); background: var(--field);
    border: 1px solid var(--line); border-radius: 7px; outline: none; font: inherit; font-size: 12px; }
  textarea:focus { border-color: var(--accent); }
  footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .hint { color: var(--faint); font-size: 10.5px; }
  .go { padding: 6px 14px; color: var(--accent-text); background: var(--accent); border-color: var(--accent); font-size: 11.5px; font-weight: 600; }
  .go:hover:not(:disabled) { background: var(--accent); filter: brightness(1.08); }
  .brew { display: flex; align-items: center; gap: 10px; min-height: 64px; color: var(--soft-text); font-size: 12px; }
  .brew.fail { color: var(--danger); }
  .prompt-result { max-height: 240px; padding: 9px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; background: var(--field); border: 1px solid var(--line); border-radius: 7px; }
  .brew svg { flex: none; width: 52px; height: 52px; overflow: visible; }
  .glass { fill: none; stroke: var(--soft-text); stroke-width: 1.5; stroke-linecap: round; }
  .liquid { fill: #7fe0a0; animation: slosh 1.6s ease-in-out infinite; transform-origin: 24px 29px; }
  .bubble { fill: #c9f5d6; animation: rise 1.4s ease-in infinite; }
  .b2 { animation-delay: .45s; } .b3 { animation-delay: .9s; }
  .vapor { fill: none; stroke: #c7a6f2; stroke-width: 1.4; stroke-linecap: round; animation: steam 1.8s ease-in-out infinite; }
  .flame { fill: var(--accent); transform-origin: 24px 47px; animation: flicker .5s ease-in-out infinite alternate; }
  .still .bubble, .still .vapor, .still .flame { animation: none; opacity: 0; }
  .still .liquid { animation: none; }
  .fail .liquid { fill: var(--danger); }
  @keyframes slosh { 50% { transform: translateY(1.2px) rotate(-3deg); } }
  @keyframes rise { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(-30px); opacity: 0; } }
  @keyframes steam { 0% { opacity: 0; transform: translateY(2px); } 50% { opacity: .9; } 100% { opacity: 0; transform: translateY(-6px); } }
  @keyframes flicker { to { transform: scale(.85, 1.1); } }
</style>
