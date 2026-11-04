import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeClient} from '../frontend/src/node.js';
import {createNodeSaves, isNodePackage} from '../frontend/src/node-saves.js';

const config = {base: 'http://127.0.0.1:4400', token: 'test-token', workspace: 'project / one', vm: 'v1'};
const receipt = path => ({path, state: 'sha256:' + 'a'.repeat(64), source_revision: 'b'.repeat(40), files: 3, bytes: 150, manifest: '.alembic/node-states/' + 'a'.repeat(64) + '/state.json', git_commit: 'e'.repeat(40), git_ref: 'refs/alembic/nodes/' + 'f'.repeat(64), git_dir: '/project/main/.git', worktree: 'main'});
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return {promise, resolve}; };

test('one node save request retains the isolate and returns its committed ref', async () => {
  const calls = [], path = 'scenes/one & two.i3d', saved = receipt(path), expected = 'sha256:' + 'd'.repeat(64);
  const client = new NodeClient(config, async (url, init) => {
    calls.push({url: new URL(url), init});
    return Response.json(init.method === 'POST' ? saved : [saved]);
  });
  assert.deepEqual(await client.saveNode(path, expected), saved);
  assert.deepEqual(await client.saveNode(path), saved);
  assert.deepEqual(await client.listNodeSaves(path), [saved]);
  assert.deepEqual(JSON.parse(calls[0].init.body), {path, expected});
  assert.deepEqual(JSON.parse(calls[1].init.body), {path});
  assert.equal(calls[0].url.pathname, '/w/project%20%2F%20one/node-commit');
  assert.equal(calls[2].url.pathname, '/w/project%20%2F%20one/node-saves');
  assert.equal(calls[2].url.searchParams.get('path'), path);
  assert.equal(calls[0].init.headers.get('Content-Type'), 'application/json');
  for (const {init} of calls) {
    assert.equal(init.headers.get('Authorization'), 'Bearer test-token');
    assert.equal(init.credentials, 'omit');
  }
  client.close();
});

test('atomic save receipts accept either common Git object-ID width', async () => {
  let last;
  const value = {...receipt('scene.i3d'), source_revision: 'b'.repeat(64), git_commit: 'e'.repeat(64)};
  await createNodeSaves(update => last = update).save({saveNode: async () => value, listNodeSaves: async () => [value]}, 'scene.i3d');
  assert.equal(last.result.git_commit, 'e'.repeat(64));
  assert.equal(last.error, '');
});

test('node restore uses one authenticated request with a committed state and destination', async () => {
  const calls = [], client = new NodeClient(config, async (url, init) => {
    calls.push({url:new URL(url), init}); return Response.json({state:'sha256:'+'a'.repeat(64),destination:'main/scene-restored.i3d',files:3});
  });
  const result = await client.restoreNode('sha256:'+'a'.repeat(64), 'main/scene-restored.i3d');
  assert.deepEqual(result,{state:'sha256:'+'a'.repeat(64),destination:'main/scene-restored.i3d',files:3});
  assert.equal(calls[0].url.pathname,'/w/project%20%2F%20one/node-restore');
  assert.deepEqual(JSON.parse(calls[0].init.body),{state:'sha256:'+'a'.repeat(64),destination:'main/scene-restored.i3d'});
  assert.equal(calls[0].init.headers.get('Authorization'),'Bearer test-token');
  client.close();
});

test('restore reports verified destination and keeps failures visible', async () => {
  const state='sha256:'+'a'.repeat(64); let last;
  const client={restoreNode:async (_state,destination)=>({state,destination,files:3})};
  const saves=createNodeSaves(value=>last=value);
  await saves.restore(client,'scene.i3d',state,'scene-restored.i3d');
  assert.deepEqual(last.restoreResult,{state,destination:'scene-restored.i3d',files:3});
  assert.equal(last.restoreError,'');
  client.restoreNode=async()=>{throw new Error('409 destination exists')};
  await saves.restore(client,'scene.i3d',state,'scene-restored.i3d');
  assert.equal(last.restoreResult,null);
  assert.equal(last.restoreError,'409 destination exists');
  client.restoreNode=async()=>({state,destination:'other.i3d',files:3});
  await saves.restore(client,'scene.i3d',state,'scene-restored.i3d');
  assert.equal(last.restoreResult,null);
  assert.match(last.restoreError,/invalid node-restore receipt/);
});

test('node save failures preserve actual errors and unsupported routes suggest a Vault update', async () => {
  const client = new NodeClient(config);
  for (const status of [404, 405, 501]) {
    client.transport = async () => Response.json({error: 'unsupported', fix: 'Node saves unavailable'}, {status});
    await assert.rejects(client.saveNode('scene.glb'), new RegExp(`${status} unsupported: Node saves unavailable.*update Vault`));
    await assert.rejects(client.listNodeSaves('scene.glb'), /update Vault/);
  }
  client.transport = async () => Response.json({error: 'stale', fix: 'Read the current manifest and retry'}, {status: 409});
  await assert.rejects(client.saveNode('scene.i3d', 'sha256:' + 'd'.repeat(64)), /^Error: 409 stale: Read the current manifest and retry$/);
  client.close();
});

test('save actions deduplicate pending saves and retain their captured client/path during navigation', async () => {
  const pending = deferred(), updates = [], calls = [];
  const first = {saveNode: async (...args) => { calls.push(['first', ...args]); return pending.promise; }, listNodeSaves: async path => [receipt(path)]};
  const second = {saveNode: async (...args) => { calls.push(['second', ...args]); return receipt(args[0]); }, listNodeSaves: async () => []};
  const saves = createNodeSaves(value => updates.push(value));
  const saving = saves.save(first, 'old.glb');
  await saves.save(first, 'old.glb');
  await saves.save(second, 'new.glb');
  pending.resolve(receipt('old.glb')); await saving;
  assert.deepEqual(calls, [['first', 'old.glb', undefined], ['second', 'new.glb', undefined]]);
  assert.equal(updates[0].saving, true);
  assert.equal(updates.at(-1).client, first);
  assert.equal(updates.at(-1).path, 'old.glb');
  assert.equal(updates.at(-1).result.state, receipt('').state);
  assert.equal(updates.at(-1).saving, false);
  assert.equal(updates.at(-1).history.length, 1);
});

test('a confirmed save survives history failure, while failed and invalid saves never claim success', async () => {
  let last;
  const saves = createNodeSaves(value => last = value);
  const client = {saveNode: async path => receipt(path), listNodeSaves: async () => { throw new Error('503 history unavailable'); }};
  await saves.save(client, 'scene.i3d');
  assert.equal(last.result.state, receipt('').state);
  assert.equal(last.error, ''); assert.equal(last.historyError, '503 history unavailable');
  client.saveNode = async () => { throw new Error('422 dependencies must be declared'); };
  await saves.save(client, 'scene.i3d');
  assert.equal(last.result, null); assert.equal(last.saving, false);
  assert.equal(last.error, '422 dependencies must be declared');
  client.saveNode = async () => ({ok: true});
  await saves.save(client, 'scene.i3d');
  assert.equal(last.result, null); assert.match(last.error, /invalid node-save receipt/);
});

test('history preserves API order without labeling any state latest, and node folders qualify', async () => {
  let last;
  const history = [receipt('scene.i3d'), {...receipt('scene.i3d'), state: 'sha256:' + '0'.repeat(64)}];
  const client = {listNodeSaves: async () => history};
  await createNodeSaves(value => last = value).refresh(client, 'scene.i3d');
  assert.deepEqual(last.history, history);
  for (const path of ['scene.i3d', 'assets/scene.i2d', 'sound.audio']) assert.equal(isNodePackage(path), true);
  for (const path of ['assets', 'scene.i3d.backup', 'folder.i3d/assets']) assert.equal(isNodePackage(path), false);
});

test('a history request begun before a save cannot hide its confirmed state', async () => {
  const pending = deferred(); let last;
  const client = {listNodeSaves: async () => pending.promise, saveNode: async path => receipt(path)};
  const saves = createNodeSaves(value => last = value);
  const loading = saves.refresh(client, 'scene.i3d');
  await saves.save(client, 'scene.i3d');
  pending.resolve([]); await loading;
  assert.deepEqual(last.history, [receipt('scene.i3d')]);
  assert.equal(last.loaded, true);
  assert.equal(last.loading, false);
});
