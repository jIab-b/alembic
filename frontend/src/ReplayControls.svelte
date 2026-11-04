<script lang="ts">
  import type {Replay} from './replay.svelte';
  let {replay, showUnavailable = false}: {replay: Replay; showUnavailable?: boolean} = $props();
  const stamp = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}` : '—';
  function play() {
    if (replay.start !== null && replay.end !== null)
      void replay.play(replay.time >= replay.start && replay.time < replay.end ? undefined : replay.start, replay.end);
    else void replay.play();
  }
</script>

{#if replay.available || showUnavailable}
  <div class="transport" role="toolbar" aria-label="Replay controls" title={replay.available ? undefined : 'This view has no timed replay source'}>
    <button aria-label="Play replay" title="Play" disabled={!replay.available || replay.playing} onclick={play}>
      <svg viewBox="0 0 16 16"><path d="M5 3l8 5-8 5z" /></svg>
    </button>
    <button aria-label="Pause replay" title="Pause" disabled={!replay.playing} onclick={replay.pause}><svg viewBox="0 0 16 16"><path d="M5 3v10M11 3v10" /></svg></button>
    <button aria-label="Previous frame" title="Step back 1/30 second" disabled={!replay.available} onclick={() => replay.step(-1)}><svg viewBox="0 0 16 16"><path d="M3 3v10M12 3 5 8l7 5z" /></svg></button>
    <button aria-label="Next frame" title="Step forward 1/30 second" disabled={!replay.available} onclick={() => replay.step(1)}><svg viewBox="0 0 16 16"><path d="M13 3v10M4 3l7 5-7 5z" /></svg></button>
    <input type="range" aria-label="Replay position" disabled={!replay.available} min="0" max={Number.isFinite(replay.duration) ? replay.duration || 1 : Math.max(1,replay.time)} step="0.001" value={replay.time}
      oninput={event => replay.seek(Number(event.currentTarget.value))} />
    <span class="time" aria-live="off" title={replay.available ? `Duration: ${stamp(replay.duration)}` : 'Duration unavailable'}>{replay.available ? stamp(replay.time) : '—'}<span class="duration"> / {replay.available ? stamp(replay.duration) : '—'}</span></span>
  </div>
{/if}

<style>
  .transport { container: replay / inline-size; display: flex; flex-wrap: wrap; grid-column: 1 / -1; grid-row: 2; justify-self: center; align-items: center; gap: 2px; width: 350px; min-width: 0; max-width: 100%;
    padding: 2px 6px; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--field); }
  button { flex: 0 0 22px; display: grid; place-items: center; flex: none; min-width: 22px; height: 24px; padding: 0 3px; border: 0; border-radius: 5px; background: transparent; color: var(--soft-text); font-size: 10px; }
  svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linejoin: round; }
  input { flex: 1 1 40px; min-width: 20px; width: 80px; margin: 0 4px; }
  .time { flex: none; color: var(--muted); font: 10px ui-monospace, monospace; white-space: nowrap; }
  @container canvas-tools (min-width: 440px) {
    .transport { grid-column: 2; grid-row: 1; }
  }
  @container replay (max-width: 280px) {
    .duration { display: none; }
  }
  @container replay (max-width: 220px) {
    button { flex-basis: 18px; min-width: 18px; }
    input { flex-basis: 24px; margin-inline: 2px; }
  }
</style>
