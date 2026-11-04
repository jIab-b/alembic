#!/usr/bin/env node
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] || fileURLToPath(new URL('../frontend/public/examples', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const time = step => `2026-01-01T00:0${step}:00.000Z`;
const block = (name, mesh, translation, scale) => ({ name, mesh, translation, scale });
const material = (name, color) => ({ name, pbrMetallicRoughness: {
  baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 0.8
} });

function cube() {
  const positions = [], normals = [], indices = [];
  const faces = [
    [[1, 0, 0], [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]]],
    [[-1, 0, 0], [[-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-.5, -.5, -.5]]],
    [[0, 1, 0], [[-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5]]],
    [[0, -1, 0], [[-.5, -.5, .5], [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5]]],
    [[0, 0, 1], [[.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5], [-.5, -.5, .5]]],
    [[0, 0, -1], [[-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5], [.5, -.5, -.5]]]
  ];
  for (const [normal, vertices] of faces) {
    const start = positions.length / 3;
    for (const vertex of vertices) { positions.push(...vertex); normals.push(...normal); }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return { positions, normals, indices, min: [-.5, -.5, -.5], max: [.5, .5, .5] };
}

function sphere() {
  const positions = [], normals = [], indices = [];
  const rows = 12, columns = 20;
  for (let y = 0; y <= rows; y++) {
    const phi = Math.PI * y / rows;
    for (let x = 0; x <= columns; x++) {
      const theta = 2 * Math.PI * x / columns;
      const point = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
      positions.push(...point); normals.push(...point);
    }
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const a = y * (columns + 1) + x, b = a + columns + 1;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return { positions, normals, indices, min: [-1, -1, -1], max: [1, 1, 1] };
}

function document(nodes, colors) {
  const chunks = [], bufferViews = [], accessors = [], primitives = [];
  let byteOffset = 0;
  const attribute = (values, type, componentType, bounds = {}) => {
    const bytes = componentType === 5126 ? new Float32Array(values) : new Uint16Array(values);
    const buffer = Buffer.from(bytes.buffer);
    const view = bufferViews.push({ buffer: 0, byteOffset, byteLength: buffer.length }) - 1;
    chunks.push(buffer); byteOffset += buffer.length;
    return accessors.push({ bufferView: view, componentType, count: values.length / (type === 'VEC3' ? 3 : 1), type, ...bounds }) - 1;
  };
  for (const geometry of [cube(), sphere()]) {
    const position = attribute(geometry.positions, 'VEC3', 5126, { min: geometry.min, max: geometry.max });
    const normal = attribute(geometry.normals, 'VEC3', 5126);
    const indices = attribute(geometry.indices, 'SCALAR', 5123);
    primitives.push({ attributes: { POSITION: position, NORMAL: normal }, indices });
  }
  return {
    asset: { version: '2.0', generator: 'Alembic deterministic examples' },
    scene: 0, scenes: [{ nodes: nodes.map((_, index) => index) }], nodes,
    meshes: colors.map((_, index) => ({ primitives: [{ ...primitives[index === 4 ? 1 : 0], material: index }] })),
    materials: colors.map(([name, color]) => material(name, color)),
    buffers: [{ byteLength: byteOffset, uri: `data:application/octet-stream;base64,${Buffer.concat(chunks).toString('base64')}` }],
    bufferViews, accessors
  };
}

const colors = [
  ['Ground', [.3, .36, .35]], ['Blue', [.18, .43, .66]], ['Ochre', [.82, .64, .25]],
  ['Violet', [.48, .38, .64]], ['Orange', [.95, .45, .18]]
];
const towers = document([
  block('Ground', 0, [0, -.15, 0], [12, .3, 10]),
  block('Tower 1', 1, [-3, 1.5, 0], [1.3, 3, 1.3]),
  block('Tower 2', 2, [0, 2, 0], [1.5, 4, 1.5]),
  block('Tower 3', 3, [3, 1.25, 0], [1.3, 2.5, 1.3]),
  block('Sphere', 4, [0, .8, 3], [.8, .8, .8])
], colors);
const arch = document([
  block('Ground', 0, [0, -.15, 0], [11, .3, 8]),
  block('Left Pillar', 1, [-2, 1.5, 0], [1, 3, 1.4]),
  block('Right Pillar', 1, [2, 1.5, 0], [1, 3, 1.4]),
  block('Lintel', 2, [0, 3.4, 0], [5, .8, 1.4]),
  block('Keystone', 3, [0, 3.5, .8], [.9, 1.1, .5])
], colors.slice(0, 4));
const selection = (id, tag, shape, center, extent) => ({
  id, tag, shape, center, ...(shape === 'sphere' ? { radius: extent } : { size: extent }), objects: [], crop: null
});
// What the app's own bounding-box test selects in the scene as it was when the selection was made.
const hits = (scene, volume) => scene.nodes.flatMap((node, index) => {
  const half = node.scale.map(s => s * (node.mesh === 4 ? 1 : .5)), gap = node.translation.map((v, i) => Math.abs(v - volume.center[i]) - half[i]);
  const inside = volume.shape === 'sphere' ? Math.hypot(...gap.map(g => Math.max(g, 0))) <= volume.radius
    : gap.every((g, i) => g <= volume.size[i] / 2);
  return inside ? [{ node: index, name: node.name }] : [];
});
const towerSteps = [
  [scene => { scene.materials[2] = material('Red', [.86, .12, .10]); },
    selection('s1', 'Make tower 2 red', 'sphere', [0, 2, 0], 1.8)],
  [scene => { scene.nodes[3].translation = [3, 2.4, 0]; scene.nodes[3].scale = [1.6, 4.8, 1.6]; },
    selection('s2', 'Raise tower 3', 'box', [3, 2.4, 0], [1.8, 4.6, 1.8])],
  [scene => { scene.nodes.push(block('Tower 1 Copy', 1, [-3, 1.5, 3], [1.3, 3, 1.3])); scene.scenes[0].nodes.push(5); },
    selection('s3', 'Duplicate tower 1 toward the front', 'box', [-3, 1.7, 0], [1.6, 3, 1.6])]
];
const archSteps = [
  [scene => { scene.materials[3] = material('Gold', [.95, .66, .12]); },
    selection('s1', 'Gold keystone', 'sphere', [0, 3.5, .8], .7)],
  [scene => {
    for (const index of [1, 2]) { scene.nodes[index].translation[1] = 2; scene.nodes[index].scale[1] = 4; }
    scene.nodes[3].translation[1] = 4.4; scene.nodes[4].translation[1] = 4.5;
  }, selection('s2', 'Raise the arch', 'box', [0, 2.75, 0], [5.3, 5.1, 2.2])],
  [scene => { scene.nodes.push(block('Threshold', 2, [0, .1, 1.8], [2.5, .2, 1.2])); scene.scenes[0].nodes.push(5); },
    selection('s3', 'Add a threshold here', 'box', [0, .15, 1.8], [2.7, .2, 1.4])]
];

async function writeExample(name, title, description, scene, steps) {
  const directory = join(output, name), history = [], selections = [];
  await mkdir(join(directory, '.alembic/history'), { recursive: true });
  for (let index = 0; index <= steps.length; index++) {
    if (index) {
      const [edit, chosen] = steps[index - 1];
      selections.splice(0, selections.length, { ...chosen, objects: hits(scene, chosen) });
      edit(scene);
    }
    const bytes = encode(scene), sha256 = hash(bytes);
    history.push({ at: time(index), file: 'scene.gltf', sha256, bytes: bytes.length, selection: structuredClone(selections) });
    await writeFile(join(directory, '.alembic/history', sha256), bytes);
    if (index === steps.length) {
      await writeFile(join(directory, 'scene.gltf'), bytes);
      await writeFile(join(directory, '.alembic/selection.json'), encode({
        version: 1, file: 'scene.gltf', sha256, at: time(index), selections
      }));
    }
  }
  await writeFile(join(directory, 'files.json'), encode(['scene.gltf']));
  await writeFile(join(directory, '.alembic/history.jsonl'), history.map(line => JSON.stringify(line)).join('\n') + '\n');
  return { name, title, file: 'scene.gltf', description, scripted: true };
}

await mkdir(output, { recursive: true });
const svgName = 'skyforge', svgFile = 'skyforge.svg';
const svg = await readFile(new URL('../frontend/public/examples/skyforge/skyforge.svg', import.meta.url));
const svgHash = hash(svg), svgDirectory = join(output, svgName);
await mkdir(join(svgDirectory, '.alembic/history'), {recursive: true});
await writeFile(join(svgDirectory, svgFile), svg);
await writeFile(join(svgDirectory, 'files.json'), encode([svgFile]));
await writeFile(join(svgDirectory, '.alembic/history', svgHash), svg);
await writeFile(join(svgDirectory, '.alembic/history.jsonl'), JSON.stringify({at: time(0), file: svgFile, sha256: svgHash, bytes: svg.length, selection: []}) + '\n');
await writeFile(join(svgDirectory, '.alembic/selection.json'), encode({version: 1, file: svgFile, sha256: svgHash, at: time(0), selections: []}));
const manifest = [
  {name: svgName, title: 'Skyforge', file: svgFile, description: 'An animated SVG city. Highlight its reactor and make it your own.', scripted: false},
  await writeExample('towers', 'Towers', 'Change a tower’s color, height or shape.', towers, towerSteps),
  await writeExample('arch', 'Archway', 'Try a new keystone or reshape the arch.', arch, archSteps)
];
await writeFile(join(output, 'manifest.json'), encode(manifest));
