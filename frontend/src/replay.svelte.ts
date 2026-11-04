export type Moment = {time: number; start?: number; end?: number; clip?: string; sha256?: string;
  camera?: {position: number[]; target: number[]}};
export type ReplaySource = {duration: number; clip?: string; seek: (time: number) => void | Promise<void>;
  play?: () => Promise<void>; pause?: () => void; currentTime?: () => number;
  capture?: (area?: number[]) => Promise<Uint8Array | null>};

// One clock and transport for native scenes, SVG timelines, and recorded video.
export function createReplay(onerror: (message: string) => void) {
  let source = $state.raw<ReplaySource | null>(null), time = $state(0), playing = $state(false);
  let start = $state<number | null>(null), end = $state<number | null>(null);
  let frame = 0, last = 0, limit = 0, generation = 0, pending = Promise.resolve();
  const clamp = (value: number) => Math.max(0, Math.min(source?.duration ?? 0, Number.isFinite(value) ? value : 0));
  function pause() {
    generation++; cancelAnimationFrame(frame); playing = false; source?.pause?.();
    if (source?.currentTime) time = clamp(source.currentTime());
  }
  function seek(value: number) {
    pause(); time = clamp(value);
    const target = source, current = generation;
    pending = Promise.resolve(target?.seek(time)).catch(e => {
      if (source === target && current === generation) onerror(`Replay: ${e.message}`);
    });
    return pending;
  }
  function tick(now: number) {
    if (!source || !playing) return;
    time = clamp(source.currentTime ? source.currentTime() : time + (now - last) / 1000);
    last = now;
    if (time >= limit - 0.0001) { void seek(limit); return; }
    if (!source.currentTime) source.seek(time);
    frame = requestAnimationFrame(tick);
  }
  async function play(from?: number, to = source?.duration ?? 0) {
    if (!source || !source.duration) return;
    const target = source;
    let current = generation;
    if (from !== undefined || time >= to - 0.0001) {
      const seeking = seek(from ?? 0); current = generation;
      await seeking;
    }
    if (source !== target || current !== generation) return;
    current = ++generation;
    limit = to === Infinity && target.duration === Infinity ? Infinity : clamp(to);
    try {
      await target.play?.();
      if (current !== generation) return;
      playing = true; last = performance.now(); frame = requestAnimationFrame(tick);
    } catch (e) {
      if (source === target && current === generation) { pause(); onerror(`Cannot play: ${(e as Error).message}`); }
    }
  }
  function attach(next: ReplaySource) {
    reset();
    if ((!Number.isFinite(next.duration) && next.duration !== Infinity) || next.duration < 0) return () => {};
    source = next; void seek(0);
    return () => { if (source === next) reset(); };
  }
  function reset() { pause(); source = null; time = 0; start = end = null; }
  function restore(moment: Moment) {
    start = moment.start ?? null; end = moment.end ?? null;
    return seek(moment.time);
  }
  const snapshot = (): Moment => ({time, ...(start !== null && end !== null && end > start ? {start, end} : {}),
    ...(source?.clip ? {clip: source.clip} : {})});
  return {
    get available() { return source !== null && source.duration > 0; }, get duration() { return source?.duration ?? 0; },
    get time() { return time; }, get playing() { return playing; }, get start() { return start; }, get end() { return end; },
    attach, reset, pause, seek, play, restore, snapshot,
    toggle: () => playing ? pause() : void play(),
    step: (direction: number) => seek(time + direction / 30),
    restart: () => seek(0), replay: () => play(start ?? 0, end ?? source?.duration ?? 0),
    mark: (edge: 'start' | 'end') => {
      pause();
      if (edge === 'start') { start = time; if (end !== null && end <= time) end = null; }
      else { end = time; if (start === null || start >= time) start = 0; }
    },
    clearRange: () => { start = end = null; },
    capture: async (area?: number[]) => {
      const target = source;
      pause(); const current = generation;
      await pending;
      if (source !== target || current !== generation) return null;
      try {
        const image = await target?.capture?.(area);
        return source === target && current === generation ? image ?? null : null;
      } catch (e) {
        if (source === target && current === generation) onerror(`Crop failed: ${(e as Error).message}`);
        return null;
      }
    }
  };
}
export type Replay = ReturnType<typeof createReplay>;
