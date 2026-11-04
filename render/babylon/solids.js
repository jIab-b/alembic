import {container, pack, radii} from './document.js';

// Additive glTF edits retain the source's buffers, extensions, animations and node indices. Only nodes
// owned by this editor are changed; removing one detaches it rather than renumbering unrelated nodes.
const marker = 'alembicSolid';
export const solidLabel = item => item.tag || `${item.mode === 'real' ? 'Solid' :
  'Highlight'} ${item.shape === 'pick' ? 'object' : item.shape}`;
export function isSolid(item) { return item.mode === 'real' && typeof item.solidId === 'string'; }
export function readSolids(source) {
  const {json} = container(source), nodes = json.nodes ?? [], active = new Set();
  const visit = index => { if (active.has(index)) return; active.add(index);
    for (const child of nodes[index]?.children ?? []) visit(child); };
  for (const index of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(index);
  return [...active].flatMap(index => {
    const node = nodes[index], value = node?.extras?.[marker];
    if (!value || value.removed || !['sphere','box'].includes(value.shape) ||
      !/^[a-zA-Z0-9_-]+$/.test(value.id) || node.matrix || node.rotation?.some((n, k) => n !== (k === 3 ? 1 :
        0))) return [];
    const center = node.translation ?? [0,0,0], scale = node.scale ?? [1,1,1];
    if (!validVector(center) || !validVector(scale) || scale.some(n => n <= 0)) return [];
    return [{...value, center: [...center], ...(value.shape === 'sphere' ? {radius: Math.max(...scale), radii:
      [...scale]} : {size: [...scale]}), solidId: value.id, mode: 'real', name: node.name, node: index}];
  });
}
function primitive(shape) {
  const positions = [], normals = [], indices = [];
  if (shape === 'box') {
    for (const [normal, corners] of [
      [[1,0,0], [[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]],
      [[-1,0,0], [[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]],
      [[0,1,0], [[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]],
      [[0,-1,0], [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]],
      [[0,0,1], [[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]],
      [[0,0,-1], [[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]]
    ]) {
      const start = positions.length / 3;
      for (const corner of corners) { positions.push(...corner); normals.push(...normal); }
      indices.push(start,start+1,start+2,start,start+2,start+3);
    }
  } else {
    const width = 24, height = 16;
    for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
      const phi = x / width * Math.PI * 2, theta = y / height * Math.PI;
      const p = [-Math.cos(phi)*Math.sin(theta), Math.cos(theta), Math.sin(phi)*Math.sin(theta)];
      positions.push(...p); normals.push(...p);
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const a = y * (width + 1) + x, b = a + width + 1;
      if (y) indices.push(a,b,a+1);
      if (y < height-1) indices.push(a+1,b,b+1);
    }
  }
  return {positions: new Float32Array(positions), normals: new Float32Array(normals), indices:
    new Uint16Array(indices)};
}
function bytesOf(array) { return new Uint8Array(array.buffer, array.byteOffset, array.byteLength); }
function dataURI(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:application/octet-stream;base64,' + btoa(text);
}
function validVector(value) { return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite); }
function serialize(source, json, bin, binary) {
  if (!binary) return new TextEncoder().encode(JSON.stringify(json) + '\n');
  const output = pack(json, bin), unknown = [];
  const header = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (source.length >= 12 && header.getUint32(0, true) === 0x46546c67) {
    for (let offset = 12; offset + 8 <= source.length;) {
      const length = header.getUint32(offset, true), type = header.getUint32(offset + 4, true);
      if (offset + length + 8 > source.length) throw new Error('Invalid GLB chunk');
      if (![0x4e4f534a, 0x004e4942].includes(type)) unknown.push(source.subarray(offset, offset + length + 8));
      offset += length + 8;
    }
  }
  if (!unknown.length) return output;
  const result = new Uint8Array(output.length + unknown.reduce((n, chunk) => n + chunk.length, 0));
  result.set(output); let offset = output.length;
  for (const chunk of unknown) { result.set(chunk, offset); offset += chunk.length; }
  new DataView(result.buffer).setUint32(8, result.length, true);
  return result;
}
export function editSolid(source, path, solidId, item) {
  const {json, bin} = container(source);
  if (String(json.asset?.version).split('.')[0] !== '2') throw new Error('Solid objects require glTF 2');
  if (!/^[a-zA-Z0-9_-]+$/.test(solidId)) throw new Error('Invalid solid identity');
  const binary = /\.glb$/i.test(path);
  if (!binary && !/\.gltf$/i.test(path)) throw new Error('Solid objects require a GLB or glTF file');
  json.nodes ??= [];
  let index = json.nodes.findIndex(node => node.extras?.[marker]?.id === solidId);
  if (!item) {
    if (index < 0) return source;
    for (const scene of json.scenes ?? []) if (scene.nodes) scene.nodes = scene.nodes.filter(n => n !== index);
    for (const node of json.nodes) if (node.children) node.children = node.children.filter(n => n !== index);
    json.nodes[index] = {name: 'Removed solid', extras: {[marker]: {id: solidId, removed: true}}};
    return serialize(source, json, bin, binary);
  }
  if (!['box','sphere'].includes(item.shape) || !validVector(item.center)) throw new Error('Choose a 3D box or sphere');
  const scale = item.shape === 'sphere' ? radii(item) : item.size;
  if (!validVector(scale) || scale.some(value => value <= 0)) throw new Error('Solid dimensions must be positive');
  json.meshes ??= []; json.materials ??= []; json.buffers ??= []; json.bufferViews ??= []; json.accessors ??= [];
  let mesh = json.meshes.findIndex(value => value.extras?.alembicPrimitive === item.shape);
  let resultBin = bin;
  if (mesh < 0) {
    const geometry = primitive(item.shape), parts = [geometry.positions, geometry.normals, geometry.indices];
    const offsets = [0, geometry.positions.byteLength, geometry.positions.byteLength + geometry.normals.byteLength];
    const total = offsets[2] + geometry.indices.byteLength;
    let buffer, base = 0;
    if (binary) {
      if (json.buffers[0]?.uri) throw new Error('GLB buffer must be embedded');
      base = ((bin?.length ?? 0) + 3) & ~3;
      resultBin = new Uint8Array(base + total);
      if (bin) resultBin.set(bin);
      buffer = 0;
      if (!json.buffers.length) json.buffers.push({byteLength: resultBin.length});
      else json.buffers[0] = {...json.buffers[0], byteLength: resultBin.length};
      parts.forEach((part, i) => resultBin.set(bytesOf(part), base + offsets[i]));
    } else {
      const data = new Uint8Array(total);
      parts.forEach((part, i) => data.set(bytesOf(part), offsets[i]));
      buffer = json.buffers.push({byteLength: total, uri: dataURI(data)}) - 1;
    }
    const accessors = parts.map((part, i) => {
      const bufferView = json.bufferViews.push({buffer, byteOffset: base + offsets[i], byteLength: part.byteLength,
        target: i === 2 ? 34963 : 34962}) - 1;
      const accessor = {bufferView, componentType: i === 2 ? 5123 : 5126, count: i === 2 ? part.length :
        part.length / 3, type: i === 2 ? 'SCALAR' : 'VEC3'};
      if (i === 0) { const extent = item.shape === 'sphere' ? 1 : .5; accessor.min = [-extent,-extent,-extent];
        accessor.max = [extent,extent,extent]; }
      return json.accessors.push(accessor) - 1;
    });
    let material = json.materials.findIndex(value => value.extras?.alembicSolidMaterial);
    if (material < 0) material = json.materials.push({name: 'Solid stone', pbrMetallicRoughness: {baseColorFactor:
      [.48,.56,.65,1], metallicFactor: 0, roughnessFactor: .7}, extras: {alembicSolidMaterial: true}}) - 1;
    mesh = json.meshes.push({name: `Solid ${item.shape}`, primitives: [{attributes: {POSITION: accessors[0], NORMAL:
      accessors[1]}, indices: accessors[2], material}], extras: {alembicPrimitive: item.shape}}) - 1;
  }
  const node = {name: solidLabel({...item, mode: 'real'}), mesh, translation: [...item.center], scale: [...scale],
    extras: {[marker]: {id: solidId, shape: item.shape, center: [...item.center], ...(item.shape === 'box' ? {size:
      [...scale]} : {radius: Math.max(...scale), radii: [...scale]})}}};
  if (index < 0) index = json.nodes.push(node) - 1; else json.nodes[index] = node;
  if (!json.scenes?.length) { json.scenes = [{nodes: []}]; json.scene = 0; }
  const scene = json.scenes[json.scene ?? 0]; scene.nodes ??= [];
  if (!scene.nodes.includes(index)) scene.nodes.push(index);
  return serialize(source, json, resultBin, binary);
}
