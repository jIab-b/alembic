import {bindRender} from '../html/runtime.js';
import {backendFor} from '../registry.js';
const { render, scenarios, exports: declared, background, html } = window.__alMedia;
const origin = location.origin, source = render.entry;
const send = data => parent.postMessage(data, origin);
const fail = error => send({ type: 'alembic.web.failure', error: String(error.message || error) });
if (!html) {
    Object.assign(document.documentElement.style, { height: '100%', background });
    Object.assign(document.body.style, { margin: 0, height: '100%', display: 'grid', placeItems: 'center' });
}
let media, dispose = () => {
}, layer;
const load = async () => {
    if (html) {
        media = window.alembicAudio || window;
        dispose = () => media.dispose?.();
    }
    else if (render.format === 'webaudio' && source.endsWith('.js')) {
        const module = await import(/* @vite-ignore */ new URL(source, location.href).href);
        const audio = await (module.default || module.create)?.() || module;
        media = audio;
        dispose = () => audio.dispose?.();
    }
    else if (['sprite', 'sprites'].includes(render.format) && source.endsWith('.json')) {
        const response = await fetch(source), sprite = await response.json();
        if (!response.ok || typeof sprite.image !== 'string' || !Array.isArray(sprite.frames) || !sprite.frames.length)
            throw Error('Sprite JSON requires image, frames: [[x,y,width,height]], and optional fps');
        const image = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(Error('Cannot decode sprite image'));
            image.src = new URL(sprite.image, new URL(source, location.href));
        });
        media = document.createElement('canvas');
        document.body.append(media);
        media.seek = time => {
            const frame = sprite.frames[Math.floor(time * (sprite.fps || 1)) % sprite.frames.length];
            if (!Array.isArray(frame) || frame.length !== 4 || !frame.every(Number.isFinite))
                throw Error('Invalid sprite frame');
            media.width = frame[2];
            media.height = frame[3];
            media.getContext('2d').drawImage(image, ...frame, 0, 0, frame[2], frame[3]);
        };
        media.seek(0);
    }
    else if (render.format === 'svg') {
        const response = await fetch(source);
        if (!response.ok)
            throw Error('Cannot load SVG');
        document.body.innerHTML = await response.text();
        media = document.querySelector('svg');
        if (!media)
            throw Error('Cannot decode SVG');
        const width = media.width.baseVal.value, height = media.height.baseVal.value;
        if (!media.hasAttribute('viewBox') && width > 0 && height > 0)
            media.setAttribute('viewBox', `0 0 ${width} ${height}`);
        media.pauseAnimations();
        media.getAnimations({ subtree: true }).forEach(animation => animation.pause());
    }
    else {
        const audio = /^(wav|mp3|ogg|flac|m4a|aac|opus)$/.test(render.format);
        media = document.createElement(audio ? 'audio' : 'img');
        media.src = source;
        media.controls = audio;
        document.body.append(media);
        await new Promise((resolve, reject) => {
            media.addEventListener(audio ? 'loadedmetadata' : 'load', resolve, { once: true });
            media.addEventListener('error', () => reject(Error('Cannot decode ' + source)), { once: true });
        });
        dispose = () => {
            if (audio) {
                media.pause();
                media.removeAttribute('src');
                media.load();
            }
        };
    }
    if (media.localName === 'svg')
        Object.assign(media.style, { width: '100%', height: '100%', display: 'block' });
    if (media.localName === 'img')
        Object.assign(media.style, { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' });
};
try {
    await load();
    if (media.localName === 'svg' || media.localName === 'img')
        window.alembicCapture = area => mediaCapture(media, area);
    let cleanup, timer;
    const binding = await bindRender({
        port: backendFor(render.format).port, renders: [render.id], scenarios: scenarios.map(row => row.id),
        exports: declared.map(row => row.id),
        capture: area => mediaCapture(media, area),
        io(on) {
            layer?.remove();
            if (!on) {
                layer = document.createElement('div');
                Object.assign(layer.style, {position: 'fixed', inset: 0});
                layer.dataset.alembicOverlay = '';
                document.body.append(layer);
            }
        },
        async play(scenario) {
            clearTimeout(timer);
            await cleanup?.();
            cleanup = await new (Object.getPrototypeOf(async function () {}).constructor)
                ('render', 'media', scenario.script)(media, media);
            const row = scenarios.find(row => row.id === scenario.id);
            if (!row) throw Error('Unknown playback');
            if (row.duration !== null) timer = setTimeout(() => {
                media.pause?.(); cleanup?.(); binding.emit('time', row.duration);
            }, row.duration * 1000);
        },
        async reset() {
            clearTimeout(timer);
            await cleanup?.(); cleanup = null;
            await dispose();
            if (html) { location.reload(); return; }
            layer?.remove(); document.body.replaceChildren();
            await load();
        }
    });
}
catch (error) {
    fail(error);
}

// Match the shared media preview's contain/crop geometry in the isolated frame.
async function mediaCapture(media, area = [0, 0, 1, 1]) {
    let source = media, url;
    if (media.localName === 'svg') {
        const copy = media.cloneNode(true), elements = [media, ...media.querySelectorAll('*')];
        [copy, ...copy.querySelectorAll('*')].forEach((element, i) => {
            const style = getComputedStyle(elements[i]);
            for (const property of [
                'fill', 'stroke', 'opacity', 'transform', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'd'
            ])
                element.style.setProperty(property, style.getPropertyValue(property));
            for(const attribute of [...element.attributes])
                if(attribute.name.startsWith('on'))element.removeAttribute(attribute.name);
            element.style.animation = 'none';
            element.style.transition = 'none';
        });
        copy.querySelectorAll('animate,animateTransform,animateMotion,set,script').forEach(node => node.remove());
        copy.setAttribute('width', innerWidth);
        copy.setAttribute('height', innerHeight);
        url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
        source = new Image();
        source.src = url;
        await source.decode();
    }
    try {
        const full = new OffscreenCanvas(innerWidth, innerHeight), ctx = full.getContext('2d');
        const width = source.naturalWidth || source.width, height = source.naturalHeight || source.height;
        const scale = Math.min(innerWidth / width, innerHeight / height);
        ctx.drawImage(source, (innerWidth - width * scale) / 2, (innerHeight - height * scale) / 2, width * scale,
          height * scale);
        const [x, y, w, h] = area, fit = Math.min(1, 512 / Math.max(w * innerWidth, h * innerHeight));
        const out = new OffscreenCanvas(Math.max(1, w * innerWidth * fit), Math.max(1, h * innerHeight * fit));
        out.getContext('2d').drawImage(full, x * innerWidth, y * innerHeight, w * innerWidth, h * innerHeight, 0, 0,
          out.width, out.height);
        return (await out.convertToBlob({ type: 'image/png' })).arrayBuffer();
    }
    finally {
        if (url)
            URL.revokeObjectURL(url);
    }
}
