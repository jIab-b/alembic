// Declared formats select their implementation outside the frontend.
const images = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'], audio = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac',
  'opus'];
export const types = {
    i3d: {
        formats: ['babylon', 'glb', 'gltf', 'godot', 'stream'], tools: ['sphere', 'box', 'pick'], children: ['babylon',
          'glb', 'gltf'], threeD: true
    },
    i2d: {
        formats: ['html2d', 'svg', ...images, 'sprite', 'sprites'], tools: ['area'], threeD: false
    },
    audio: { formats: [...audio, 'webaudio'], tools: [], threeD: false },
    iframe: { formats: ['app'], tools: ['area'], threeD: false }
};
export const extensions = {
    babylon: ['html'], html2d: ['html'], app: ['html'], godot: ['html', 'godot', 'stream'], webaudio: ['js', 'html'],
      sprite: [...images, 'json'], sprites: [...images, 'json'], jpg: ['jpg', 'jpeg'], jpeg: ['jpg', 'jpeg']
};
export const htmlFormats = ['babylon', 'html2d', 'app', 'godot', 'stream'];
export const labels = { babylon: 'Babylon', glb: 'GLB', gltf: 'GLB' };
const viewers = { glb: () => import('./babylon/babylon-viewer.js') };
viewers.gltf = viewers.glb;
export const loadViewer = (format = 'glb') => viewers[format]();
export const hasScene = () => !!window.BABYLON?.EngineStore?.LastCreatedScene;
