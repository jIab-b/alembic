// One row per adapter. Extensions and presentation belong to adapters, ports belong to the frontend.
const images = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'];
const sounds = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'opus'];
export const registry = [
  {formats: ['babylon'], port: 'i3d', extensions: ['html'], kind: 'app', child: true,
    label: 'Babylon', entry: ['renderer', 'babylon/runtime.js'], loader: () => import('./babylon/runtime.js')},
  {formats: ['glb', 'gltf'], port: 'i3d', extensions: ['glb', 'gltf'], kind: 'model', child: true,
    label: 'GLB', loader: () => import('./babylon/babylon-viewer.js')},
  {formats: ['html2d'], port: 'i2d', extensions: ['html'], kind: 'app',
    entry: ['html', 'html/runtime.js'], loader: () => import('./html/runtime.js')},
  {formats: ['svg', ...images, 'sprite', 'sprites'], port: 'i2d',
    extensions: ['svg', ...images, 'json'], kind: 'app', media: true, entry: ['media', 'media/runtime.js'],
    loader: () => import('./media/runtime.js')},
  {formats: [...sounds, 'webaudio'], port: 'audio', extensions: [...sounds, 'js', 'html'], kind: 'app', media: true,
    loader: () => import('./media/runtime.js')},
  {formats: ['app'], port: 'iframe', extensions: ['html'], kind: 'app', url: true,
    loader: () => import('./iframe/runtime.js')},
  {formats: ['godot'], port: 'i3d', extensions: ['html', 'godot'], kind: 'app',
    unsupported: 'Godot is unsupported for now', loader: null}
];
export const backendFor = format => registry.find(row => row.formats.includes(format));
export function requireBackend(format) {
  const row = backendFor(format);
  if (!row) throw Error('Unknown render format: ' + format);
  if (row.unsupported) throw Error(row.unsupported);
  return row;
}
export const extensions = Object.fromEntries(registry.flatMap(row => row.formats.map(format => [format,
  ['sprite', 'sprites'].includes(format) ? [...images, 'json'] : ['jpg', 'jpeg'].includes(format) ? ['jpg', 'jpeg'] :
  row.formats.length === 1 || format === 'webaudio' ? row.extensions : [format]])));
export const labels = Object.fromEntries(registry.flatMap(row => row.formats.map(format =>
  [format, row.label || format.toUpperCase()])));
export const types = Object.fromEntries(['i3d', 'i2d', 'audio', 'iframe'].map(port => [port, {
  formats: registry.filter(row => row.port === port).flatMap(row => row.formats),
  tools: port === 'i3d' ? ['sphere', 'box', 'pick'] : port === 'audio' ? [] : ['area'],
  threeD: port === 'i3d', ...(port === 'i3d' ? {children: registry.filter(row => row.child).flatMap(row =>
    row.formats)} : {})
}]));
export const loadViewer = (format = 'glb') => requireBackend(format).loader();
export const hasScene = () => !!window.BABYLON?.EngineStore?.LastCreatedScene;
export const mediaHTML = render => render.format === 'webaudio' && render.entry.endsWith('.html');
export function surfaceFor(path, render) {
  const ext = path.split('.').at(-1).toLowerCase();
  const row = render ? requireBackend(render.format) : registry.find(row => row.formats.includes(ext));
  if (row?.unsupported) throw Error(row.unsupported);
  const model = row?.kind === 'model';
  const media = !!render && !!row?.media;
  const kind = render ? row.kind : ext === 'html' ? 'app' : model ? 'model' : ext === 'svg' ? 'svg'
    : /^(mp4|webm)$/.test(ext) ? 'video' : images.includes(ext) ? 'image' : sounds.includes(ext) ? 'audio'
    : /^(json|md|txt|csv|tscn|gd|wgsl|js|ts|mjs|css|py|sh|yaml|yml|toml|xml)$/.test(ext) ? 'text' : 'other';
  return {kind, port: row?.port, format: render?.format || (model ? ext : undefined),
    lightIframe: ext === 'html' && (!render || row.port === 'iframe'),
    model, app: kind === 'app', runtime: false, media, grab: kind !== 'app'};
}
export const renderablePath = path => registry.some(row =>
  row.extensions.includes(path.split('.').at(-1).toLowerCase()))
  || /\.(mp4|webm)$/.test(path);
export function labelViews(nodes, views, replace = false) {
  for (const node of nodes.filter(row => views.includes(row.id))) {
    const row = backendFor(node.format || node.path.split('.').at(-1));
    const label = row?.label || (node.format || node.path.split('.').at(-1)).toUpperCase();
    const same = nodes.filter(n => views.includes(n.id) && backendFor(n.format || n.path.split('.').at(-1)) === row);
    const value = label + (row?.kind === 'model' && same.length > 1 ? ' · ' +
      node.path.split('/').at(-1).replace(/\.[^.]+$/, '') : '');
    if (replace) node.label = value; else node.label ??= value;
  }
}
export function previewKind(path) {
  const ext = path.split('.').at(-1).toLowerCase();
  return ['glb', 'gltf'].includes(ext) ? 'model' : ['png','jpg','jpeg','webp','gif','svg'].includes(ext) ? 'image'
    : ['mp4','webm','mov'].includes(ext) ? 'video' : ['wav','mp3','ogg','flac'].includes(ext) ? 'audio'
    : ['json','txt','md','py','js','mjs','ts','gd','tscn','godot','svg','toml','cfg'].includes(ext) ? 'text' : 'binary';
}

export const modelEditError = 'Real solids require a writable GLB or glTF file';
