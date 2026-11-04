<script lang="ts">
  import {onDestroy} from 'svelte';
  import type {Replay} from './replay.svelte';
  let {src, svg = false, audio = false, title, replay, onerror, onready = () => {}}: {src: string; svg?: boolean; audio?: boolean; title: string; replay: Replay; onerror: (message: string) => void; onready?: () => void} = $props();
  let video = $state<HTMLVideoElement | HTMLAudioElement>(null!), frame = $state<HTMLIFrameElement>(null!), detach = () => {};
  const seeks = new Set<() => void>();
  let themeObserver: MutationObserver | undefined;
  onDestroy(() => { seeks.forEach(finish => finish()); detach(); themeObserver?.disconnect(); });
  async function pixels(source: CanvasImageSource, area = [0, 0, 1, 1]) {
    const box = (svg ? frame : video).getBoundingClientRect(), canvas = document.createElement('canvas');
    const full = document.createElement('canvas'); full.width = Math.max(1, box.width); full.height = Math.max(1, box.height);
    const context = full.getContext('2d')!;
    const width = svg ? box.width : (video as HTMLVideoElement).videoWidth, height = svg ? box.height : (video as HTMLVideoElement).videoHeight;
    const scale = Math.min(box.width / width, box.height / height);
    context.drawImage(source, (box.width - width * scale) / 2, (box.height - height * scale) / 2, width * scale, height * scale);
    const [x, y, w, h] = area, factor = Math.min(1, 512 / Math.max(w * box.width, h * box.height));
    canvas.width = Math.max(1, w * box.width * factor); canvas.height = Math.max(1, h * box.height * factor);
    canvas.getContext('2d')!.drawImage(full, x * box.width, y * box.height, w * box.width, h * box.height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  function readyVideo() {
    seeks.forEach(finish => finish());
    detach();
    detach = replay.attach({duration: video.duration, seek: time => new Promise<void>(resolve => {
      if (Math.abs(video.currentTime - time) < 0.0001 && !video.seeking) { resolve(); return; }
      const target = video, events = ['seeked', 'error', 'abort', 'emptied'];
      const finish = () => {
        events.forEach(event => target.removeEventListener(event, finish));
        seeks.delete(finish); resolve();
      };
      seeks.add(finish); events.forEach(event => target.addEventListener(event, finish, {once: true}));
      try { target.currentTime = time; } catch (error) { finish(); throw error; }
    }), play: () => video.play(), pause: () => video.pause(), currentTime: () => video.currentTime,
      ...(audio ? {} : {capture: area => pixels(video as HTMLVideoElement, area)})});
    onready();
  }
  function readySvg() {
    const root = frame.contentDocument?.documentElement as unknown as SVGSVGElement;
    if (!root || root.localName !== 'svg') { onerror('Cannot load SVG preview'); return; }
    const width = root.width.baseVal.value, height = root.height.baseVal.value;
    if (!root.hasAttribute('viewBox') && width > 0 && height > 0) root.setAttribute('viewBox', `0 0 ${width} ${height}`);
    root.style.width = '100%'; root.style.height = '100%'; root.style.display = 'block';
    const background = () => root.style.backgroundColor = getComputedStyle(frame).getPropertyValue('--canvas').trim();
    background(); themeObserver?.disconnect(); themeObserver = new MutationObserver(background);
    themeObserver.observe(frame.closest('[data-theme]')!, {attributes: true, attributeFilter: ['data-theme']});
    root.pauseAnimations();
    const css = root.getAnimations({subtree: true});
    css.forEach(animation => animation.pause());
    const smil = [...root.querySelectorAll('animate, animateTransform, animateMotion, set')] as SVGAnimationElement[];
    const duration = Math.max(0, ...smil.map(animation => {
      try {
        const simple = animation.getSimpleDuration(), repeat = parseFloat(animation.getAttribute('repeatCount') || '1');
        const begin = animation.getStartTime();
        return Number.isFinite(simple) ? begin + simple * (Number.isFinite(repeat) ? repeat : 1) : 0;
      } catch { return 0; }
    }), ...css.map(animation => {
      const timing = animation.effect!.getComputedTiming();
      return Number.isFinite(timing.endTime) ? Number(timing.endTime) / 1000 : (Number(timing.duration) + Number(timing.delay)) / 1000;
    }));
    async function capture(area?: number[]) {
      // Freeze computed presentation styles into an inert SVG snapshot for the selection crop.
      const copy = root.cloneNode(true) as SVGSVGElement, originals = [root, ...root.querySelectorAll('*')], clones = [copy, ...copy.querySelectorAll('*')];
      originals.forEach((element, i) => {
        const style = frame.contentWindow!.getComputedStyle(element), target = clones[i] as SVGElement;
        for (const property of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'transform-origin', 'visibility', 'display', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd']) {
          const value = style.getPropertyValue(property); if (value) target.style.setProperty(property, value);
        }
        target.style.setProperty('animation', 'none'); target.style.setProperty('transition', 'none');
      });
      copy.querySelectorAll('animate, animateTransform, animateMotion, set, script').forEach(element => element.remove());
      copy.setAttribute('width', String(frame.clientWidth)); copy.setAttribute('height', String(frame.clientHeight));
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], {type: 'image/svg+xml'}));
      try {
        const image = new Image(); image.src = url; await image.decode(); return await pixels(image, area);
      } finally { URL.revokeObjectURL(url); }
    }
    detach();
    detach = replay.attach({duration, seek: time => { root.setCurrentTime(time); css.forEach(animation => animation.currentTime = time * 1000); }, capture});
    onready();
  }
</script>

{#if svg}
  <iframe bind:this={frame} {src} {title} sandbox="allow-same-origin" onload={readySvg}></iframe>
{:else if audio}
  <audio bind:this={video} {src} controls aria-label={title} onloadedmetadata={readyVideo} onerror={() => onerror(`Cannot decode ${title}`)}></audio>
{:else}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} {src} aria-label={title} playsinline preload="auto" onloadeddata={readyVideo}
    onerror={() => onerror(`Cannot decode ${title}${video?.error?.message ? ': ' + video.error.message : ''}`)}></video>
{/if}

<style>
  iframe, video { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  iframe { pointer-events: none; }
  video { object-fit: contain; }
</style>
