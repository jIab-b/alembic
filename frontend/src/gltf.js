// glTF containers (GLB or JSON), shared by the viewer and the CLI, and which nodes a selection holds.
const GLB = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;

export function container(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== GLB)
    return {json: JSON.parse(new TextDecoder().decode(bytes)), bin: null};
  let json, bin = null;
  for (let offset = 12; offset + 8 <= view.getUint32(8, true);) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === BIN_CHUNK && !bin) bin = chunk;
    offset += 8 + length;
  }
  return {json, bin};
}

export function animationNames(bytes) {
  const rows = container(bytes).json.animations || [];
  if (!Array.isArray(rows) || rows.length > 128) throw new Error('More than 128 clips or invalid clip metadata');
  return rows.map((clip, i) => clip.name || `Animation ${i + 1}`);
}

export function pack(json, bin) {
  const text = new TextEncoder().encode(JSON.stringify(json)), length = (text.length + 3) & ~3, binLength = bin ? (bin.length + 3) & ~3 : 0;
  const out = new Uint8Array(20 + length + (bin ? 8 + binLength : 0)), view = new DataView(out.buffer);
  [GLB, 2, out.length, length, JSON_CHUNK].forEach((value, i) => view.setUint32(i * 4, value, true));
  out.fill(0x20, 20, 20 + length); out.set(text, 20);
  if (bin) { view.setUint32(20 + length, binLength, true); view.setUint32(24 + length, BIN_CHUNK, true); out.set(bin, 28 + length); }
  return out;
}

// glTF nodes whose mesh bounds (world space, from three-viewer.js) touch a selection volume.
// A sphere is an oval when its drag dots stretched one axis: radii per axis, radius their largest.
export const radii = volume => volume.radii ?? [volume.radius, volume.radius, volume.radius];
export const half = volume => volume.shape === 'sphere' ? radii(volume) : volume.size.map(s => s / 2);
export function within(items, volume) {
  const found = new Map(), extent = half(volume);
  for (const item of items) {
    const gap = volume.center.map((c, k) => Math.max(item.min[k] - c, 0, c - item.max[k]));
    if (volume.shape === 'sphere' ? Math.hypot(...gap.map((g, k) => g / extent[k])) <= 1 : gap.every((g, k) => g <= extent[k]))
      found.set(item.node, {node: item.node, name: item.name});
  }
  return [...found.values()].sort((a, b) => a.node - b.node);
}

// Objects whose bounds, as the camera shows them, overlap a screen rectangle [x, y, width, height] in fractions
// of the view; fraction(point) is a world point's place on screen, null behind the camera.
export function framed(items, [x, y, w, h], fraction) {
  const found = new Map();
  for (const item of items) {
    const spots = [...Array(8)].map((_, i) => fraction([0, 1, 2].map(k => i >> k & 1 ? item.max[k] : item.min[k]))).filter(Boolean);
    const xs = spots.map(s => s[0]), ys = spots.map(s => s[1]);
    if (spots.length && Math.max(...xs) >= x && Math.min(...xs) <= x + w && Math.max(...ys) >= y && Math.min(...ys) <= y + h)
      found.set(item.node, {node: item.node, name: item.name});
  }
  return [...found.values()].sort((a, b) => a.node - b.node);
}

// Node identity across versions of one glTF: [name, occurrence] (the 2nd "Tower" is ["Tower", 2]); unnamed
// nodes are [null, k] for the kth unnamed node, so inserting named nodes does not shift them (inserting an
// unnamed one still does). Picks follow their node by this key when the file changes.
export function keys(json) {
  const seen = new Map();
  let unnamed = 0;
  return json.nodes.map(node => {
    if (!node.name) return JSON.stringify([null, ++unnamed]);
    const n = (seen.get(node.name) ?? 0) + 1;
    seen.set(node.name, n);
    return JSON.stringify([node.name, n]);
  });
}
