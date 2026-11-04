import test from 'node:test';
import assert from 'node:assert/strict';
import {fileChanges, runFiles, commandTitle, captureGraph} from '../frontend/src/shadow.js';

test('file captures come from path-specific outputs, including failures and deletions', () => {
  const graph = {nodes: [{id: 'build', cmd: 'blender --background\nmore', kind: 'command', exit: 1}]};
  const rows = [
    {commit: 'new', run: 'build', actor: 'agent', outputs: [{path: 'castle.glb', change: 'modified', before: 'a', after: 'b'}]},
    {commit: 'copy', run: 'copy', outputs: [{path: 'godot/castle.glb', after: 'b'}]},
    {commit: 'removed', outputs: [{path: 'castle.glb', change: 'removed', before: 'a', after: null, hash: 'a'}]},
    {commit: 'unchanged', outputs: []}
  ];
  const captures = fileChanges('castle.glb', rows, graph);
  assert.deepEqual(captures.map(item => item.commit), ['new', 'removed']);
  assert.equal(captures[0].command, 'blender --background\nmore');
  assert.equal(captures[0].exit, 1);
  assert.equal(captures[1].hash, null);
  assert.equal(captures[1].before, 'a');
  // The same output hash in another file is not a new capture of this file.
  assert.equal(captures.length, 2);
});

test('capture graph keeps repeated bytes as distinct snapshots and links only recorded prior state', () => {
  const changes = [
    {commit: 'c3', run: 'r3', hash: 'a', before: 'b', command: 'third'},
    {commit: 'c2', run: 'r2', hash: 'b', before: 'a', command: 'second'},
    {commit: 'c1', run: 'r1', hash: 'a', before: null, command: 'first'}
  ];
  const result = captureGraph('castle/castle.glb', changes);
  assert.equal(result.nodes.length, 7);
  assert.equal(new Set(result.nodes.map(node => node.id)).size, 7);
  assert.equal(result.nodes.filter(node => node.hash === 'a').length, 2);
  assert.deepEqual(result.edges.filter(edge => edge.kind === 'prior').map(edge => [edge.from, edge.to]),
    [['capture:c1', 'run:r2'], ['capture:c2', 'run:r3']]);
  assert.equal(result.nodes.find(node => node.id === 'capture:c3').layer, 2);
  const unrelated = captureGraph('castle.glb', [{...changes[0], before: 'missing'}, changes[2]]);
  assert.equal(unrelated.edges.filter(edge => edge.kind === 'prior').length, 0);
});

test('related runs retain recorded links and a 500-capture layout remains bounded', () => {
  const source = {nodes: [{id: 'parent', cmd: 'related', kind: 'turn'}], edges: [{kind: 'parent', from: 'parent', to: 'r'}]};
  const changes = [{commit: 'c', run: 'r', hash: 'a', command: 'capture'}];
  assert.equal(captureGraph('a.glb', changes, source).nodes.length, 3);
  const extended = captureGraph('a.glb', changes, source, true);
  assert.equal(extended.nodes.length, 4);
  assert.ok(extended.edges.some(edge => edge.from === 'run:parent' && edge.to === 'run:r' && edge.kind === 'related'));
  const many = Array.from({length: 500}, (_, i) => ({commit: `c${i}`, run: `r${i}`, hash: `h${i}`, before: i ? `h${i - 1}` : null})).reverse();
  const large = captureGraph('large.glb', many);
  assert.equal(large.nodes.length, 1001);
  assert.equal(large.edges.length, 1000);
  assert.ok(large.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test('lineage preserves copies and overlapping capture associations without choosing a producer', () => {
  const graph = {artifacts: [{hash: 'source', path: 'scene.py'}, {hash: 'asset', path: 'castle.glb'},
    {hash: 'asset', path: 'godot/castle.glb'}], edges: [
      {kind: 'used', from: 'source', to: 'build'}, {kind: 'produced', from: 'build', to: 'asset'},
      {kind: 'produced', from: 'copy', to: 'asset'}, {kind: 'parent', from: 'turn', to: 'build'}]};
  assert.deepEqual(runFiles(graph, 'build'), {inputs: ['scene.py'], outputs: ['castle.glb', 'godot/castle.glb']});
  assert.deepEqual(runFiles(graph, 'copy'), {inputs: [], outputs: ['castle.glb', 'godot/castle.glb']});
  assert.equal(commandTitle('python3 -\nlarge source'), 'python3 -');
  assert.equal(commandTitle(''), 'Captured change');
});
