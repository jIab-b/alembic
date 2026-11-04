// File history is built from path-specific snapshot outputs. Hash-based lineage can include copies and
// overlapping runs, so graph associations enrich the display but never invent a unique producer.
export function fileChanges(path, log, graph = {}) {
  const nodes = new Map((graph.nodes || []).map(node => [node.id, node]));
  return log.flatMap(row => {
    const output = (row.outputs || []).find(output => output.path === path);
    if (!output || typeof row.commit !== 'string') return [];
    const node = nodes.get(row.run);
    return [{commit: row.commit, run: row.run || null, at: row.at, actor: row.actor || node?.actor || '',
      exit: row.exit ?? node?.exit ?? null, change: output.change || 'modified',
      hash: ['removed', 'deleted'].includes(output.change) ? null : output.after ?? output.hash ?? null, before: output.before ?? null,
      command: node?.cmd || '', kind: node?.kind || (row.actor === 'user' ? 'edit' : 'snapshot')}];
  });
}
export function runFiles(graph, run) {
  const artifacts = new Map();
  for (const item of graph.artifacts || []) {
    if (!artifacts.has(item.hash)) artifacts.set(item.hash, new Set());
    artifacts.get(item.hash).add(item.path);
  }
  const inputs = new Set(), outputs = new Set();
  for (const edge of graph.edges || []) {
    const hash = edge.kind === 'used' && edge.to === run ? edge.from
      : edge.kind === 'produced' && edge.from === run ? edge.to : null;
    if (!hash) continue;
    for (const path of artifacts.get(hash) || []) (edge.kind === 'used' ? inputs : outputs).add(path);
  }
  return {inputs: [...inputs].sort(), outputs: [...outputs].sort()};
}
export const commandTitle = command => command?.split('\n')[0].slice(0, 180) || 'Captured change';

// The file graph uses capture identity, not just content hashes: returning to earlier bytes must not
// collapse later snapshots into a cycle or imply that one overlapping run uniquely produced them.
export function captureGraph(path, changes, source = {}, includeRelated = false) {
  const nodes = [], edges = [], runs = new Map(), previousByHash = new Map(), rows = new Map();
  const basename = path.split('/').pop();
  let latest;
  for (const change of [...changes].reverse()) {
    const previous = change.before ? previousByHash.get(change.before) : null;
    const layer = previous ? previous.layer + 1 : 0;
    const row = Math.max(previous?.row ?? 0, rows.get(layer) ?? 0);
    rows.set(layer, row + 1);
    const runId = `run:${change.run || change.commit}`;
    if (!runs.has(runId)) {
      const run = {id: runId, kind: 'run', recordKind: change.kind, run: change.run, commit: change.commit,
        title: change.command ? commandTitle(change.command) : change.kind === 'edit' ? 'File edit' : 'Snapshot capture',
        actor: change.actor, at: change.at, exit: change.exit, x: layer * 580 + 40, y: row * 275 + 40, width: 224, height: 126};
      nodes.push(run); runs.set(runId, run);
    }
    const snapshot = {id: `capture:${change.commit}`, kind: 'capture', commit: change.commit,
      title: basename, hash: change.hash, change: change.change, at: change.at,
      x: layer * 580 + 320, y: row * 275 + 40, width: 236, height: 202, layer, row};
    nodes.push(snapshot);
    edges.push({id: `capture:${change.commit}`, from: runId, to: snapshot.id, kind: 'captured', label: 'capture'});
    if (previous) edges.push({id: `prior:${change.commit}`, from: previous.id, to: runId, kind: 'prior', label: 'prior file state'});
    if (change.hash) previousByHash.set(change.hash, snapshot);
    latest = snapshot;
  }
  const live = {id: 'live', kind: 'live', commit: 'live', title: basename,
    x: latest ? latest.x + 300 : 40, y: latest?.y ?? 40, width: 236, height: 202};
  nodes.push(live);
  if (latest) edges.push({id: 'latest', from: latest.id, to: 'live', kind: 'live', label: 'latest capture'});
  if (includeRelated) {
    const existing = new Set(nodes.filter(node => node.kind === 'run').map(node => node.run));
    const related = (source.nodes || []).filter(node => !existing.has(node.id));
    const top = Math.max(...nodes.map(node => node.y + node.height)) + 120;
    related.forEach((node, index) => nodes.push({id: `run:${node.id}`, kind: 'run', recordKind: node.kind, run: node.id,
      title: commandTitle(node.cmd), actor: node.actor, at: node.at, exit: node.exit,
      x: 40 + index % 4 * 290, y: top + Math.floor(index / 4) * 175, width: 224, height: 126}));
    const ids = new Set(nodes.map(node => node.id));
    for (const [index, edge] of (source.edges || []).entries()) {
      if (['parent', 'next'].includes(edge.kind) && ids.has(`run:${edge.from}`) && ids.has(`run:${edge.to}`))
        edges.push({id: `recorded:${index}`, from: `run:${edge.from}`, to: `run:${edge.to}`, kind: 'related', label: edge.kind});
    }
  }
  return {nodes, edges};
}
