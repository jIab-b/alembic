import { htmlFormats } from '../../../render/formats.js';
export { types, extensions } from '../../../render/formats.js';
export const controls = ['io_lock', 'render', 'playback', 'prompt'];
// Presentation dispatch is chosen once at load; no engine identities enter shared UI.
export function surfaceFor(path, render) {
    const ext = path.split('.').at(-1).toLowerCase();
    const model = ['glb', 'gltf'].includes(ext);
    const media = !!render && !model && !htmlFormats.includes(render.format);
    const kind = ext === 'html' || media ? 'app' : model ? 'model' : ext === 'svg' ? 'svg'
        : /^(mp4|webm)$/.test(ext) ? 'video' : /^(png|jpg|jpeg|gif|webp|avif)$/.test(ext) ? 'image'
            : /^(mp3|wav|ogg|flac|m4a|aac|opus)$/.test(ext) ? 'audio'
                : /^(json|md|txt|csv|tscn|gd|wgsl|js|ts|mjs|css|py|sh|yaml|yml|toml|xml)$/.test(ext) ? 'text' : 'other';
    return {
        lightIframe: ext === 'html' && (!render || render.format === 'app'),
        kind, model: kind === 'model', app: kind === 'app', runtime: false, media, grab: !['app', 'runtime'].includes(
          kind)
    };
}
