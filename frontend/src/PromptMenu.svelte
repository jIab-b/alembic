<script lang="ts">
  let {mode, onchange, compact = false, autoOpenRenderTabs = false, onrenderchange}: {mode: string; onchange: (mode: 'new-session' | 'chat') => void; compact?: boolean;
    autoOpenRenderTabs?: boolean; onrenderchange: (enabled: boolean) => void} = $props();
  const id = $props.id();
  const choices = [
    {id: 'new-session' as const, label: 'Prompt new'},
    {id: 'chat' as const, label: 'Continue chat'}
  ];
  let trigger: HTMLButtonElement, menu: HTMLDivElement;
  let expanded = $state(false), left = $state(0), top = $state(0);
  function position() {
    const bounds = trigger.getBoundingClientRect();
    left = Math.max(8, Math.min(bounds.left, innerWidth - 228));
    top = bounds.bottom + 6;
  }
  function toggled(event: ToggleEvent) {
    expanded = event.newState === 'open';
    if (expanded) {
      position();
      menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    }
  }
  function key(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
</script>

<svelte:window onresize={() => menu?.hidePopover()} />
<button class="trigger" class:compact bind:this={trigger} popovertarget={id} aria-label="Settings" aria-haspopup="dialog" aria-expanded={expanded} onclick={position}>
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 2 4 0 .5 2 1.7 1 2-.6 2 3.4-1.5 1.4v2l1.5 1.4-2 3.4-2-.6-1.7 1-.5 2H8l-.5-2-1.7-1-2 .6-2-3.4 1.5-1.4v-2L1.8 7.8l2-3.4 2 .6 1.7-1Z"/><circle cx="10" cy="10" r="3"/></svg>
  {#if !compact}<span>Settings</span><span class="chevron" aria-hidden="true">⌄</span>{/if}
</button>
<div bind:this={menu} {id} popover="auto" role="dialog" tabindex="-1" aria-label="Settings" style:left={`${left}px`} style:top={`${top}px`} ontoggle={toggled} onkeydown={key}>
  <div role="radiogroup" aria-label="Canvas prompt mode">
  {#each choices as choice}<button role="radio" aria-checked={mode === choice.id} onclick={() => { onchange(choice.id); menu.hidePopover(); trigger.focus(); }}>
    <span class="check" aria-hidden="true">{mode === choice.id ? '✓' : ''}</span>{choice.label}
  </button>{/each}</div>
  <label class="render-setting"><input type="checkbox" checked={autoOpenRenderTabs} onchange={event => onrenderchange(event.currentTarget.checked)} />Auto-open render tabs</label>
</div>

<style>
  .trigger { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; padding: 8px; border-color: transparent; background: transparent; text-align: left; font-size: 13px; }
  .chevron { margin-left: auto; }
  .chevron { color: var(--muted); }
  .trigger.compact { flex: none; width: 34px; height: 34px; padding: 8px; }
  svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linejoin: round; }
  [popover] { position: fixed; inset: auto; margin: 0; padding: 4px; width: 220px; border: 1px solid var(--line-strong); border-radius: 7px; color: var(--text); background: var(--panel); box-shadow: var(--shadow); }
  .render-setting { display: flex; align-items: center; gap: 8px; padding: 10px 8px 8px; margin-top: 4px; border-top: 1px solid var(--line); font-size: 12px; cursor: pointer; }
  input { margin: 0; accent-color: var(--accent); }
  [popover]:not(:popover-open) { display: none; }
  [popover]:popover-open { display: block; }
  [role='radio'] { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px; border: 0; background: transparent; text-align: left; font-size: 12px; }
  [role='radio']:hover, [role='radio']:focus-visible { background: var(--accent-soft); }
  .check { flex: none; width: 13px; color: var(--accent); }
</style>
