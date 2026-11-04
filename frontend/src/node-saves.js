export const isNodePackage = path => /\.(?:i3d|i2d|audio|iframe)$/i.test(path);
const validSavedState = (value, path) => value && /^sha256:[a-f0-9]{64}$/.test(value.state) && value.path === path
  && Number.isInteger(value.files) && value.files > 0 && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && typeof value.manifest === 'string';
const validReceipt = (value, path) => validSavedState(value, path)
  && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.source_revision) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.git_commit)
  && /^refs\/alembic\/nodes\/[a-f0-9]{64}$/.test(value.git_ref) && typeof value.git_dir === 'string'
  && typeof value.worktree === 'string';

// Keep each action bound to its original client and path across tab/project navigation.
export function createNodeSaves(onchange) {
  const clients = new WeakMap();
  function record(client, path) {
    let paths = clients.get(client);
    if (!paths) { paths = new Map(); clients.set(client, paths); }
    if (!paths.has(path)) paths.set(path, {client, path, saving: false, loading: false, loaded: false, result: null, history: [], error: '', historyError: '', restoring: '', restoreError: '', restoreResult: null});
    return paths.get(path);
  }
  function update(current, patch) { Object.assign(current, patch); onchange({...current}); }
  async function refresh(client, path) {
    const current = record(client, path);
    if (current.loading) return;
    update(current, {loading: true, historyError: ''});
    try {
      const history = await client.listNodeSaves(path);
      if (!Array.isArray(history) || history.some(saved => !validSavedState(saved, path))) throw new Error('Vault returned an invalid saved-state history');
      // State IDs are identities, not timestamps; do not imply an ordering the API lacks.
      const unique = [...new Map(history.map(saved => [saved.state, current.result?.state === saved.state ? {...saved, ...current.result} : saved])).values()];
      if (current.result && !unique.some(saved => saved.state === current.result.state)) unique.push(current.result);
      update(current, {history: unique, loaded: true});
    } catch (error) { update(current, {historyError: error.message}); }
    finally { update(current, {loading: false}); }
  }
  async function save(client, path, expected) {
    const current = record(client, path);
    if (current.saving) return;
    update(current, {saving: true, error: '', result: null});
    try {
      const result = await client.saveNode(path, expected);
      if (!validReceipt(result, path))
        throw new Error('Vault returned an invalid node-save receipt; the save could not be verified');
      update(current, {result, history: [...current.history.filter(saved => saved.state !== result.state), result]});
      await refresh(client, path);
    } catch (error) { update(current, {error: error.message}); }
    finally { update(current, {saving: false}); }
  }
  async function restore(client, path, state, destination) {
    const current = record(client, path);
    if (current.saving || current.restoring) return;
    update(current, {restoring: state, restoreError: '', restoreResult: null});
    try {
      const result = await client.restoreNode(state, destination);
      if (!result || result.state !== state || result.destination !== destination || !Number.isInteger(result.files) || result.files < 1)
        throw new Error('Vault returned an invalid node-restore receipt; the restore could not be verified');
      update(current, {restoreResult: result});
    } catch (error) { update(current, {restoreError: error.message}); }
    finally { update(current, {restoring: '',}); }
  }
  return {save, refresh, restore};
}
