<script lang="ts">
  let {record, expanded = false, onrefresh, onrestore, onclose}: {record: any; expanded?: boolean; onrefresh: () => void; onrestore: (saved: any, destination: string) => void; onclose: () => void} = $props();
  let destinations = $state<Record<string, string>>({});
  const restorePath = (path: string, index: number) => {
    const stem = path.replace(/\.(?:i3d|i2d|audio)$/i, '');
    return `${stem}-restored-${index + 1}`;
  };
  // Primary labels stay names and counts; raw state hashes live only inside the collapsed receipts.
  const created = (value: unknown) => { const date = new Date(value as any); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(); };
</script>

<aside class="node-saves" aria-label={`Saved states for ${record.path}`}>
  <header><strong title={record.path}>{record.path}</strong><button aria-label="Close saved states" onclick={onclose}>×</button></header>
  <p role="status">
    {#if record.saving && !record.result}Saving node to tree…
    {:else if record.result}Saved · {record.result.files} {record.result.files === 1 ? 'file' : 'files'}
    {:else if !record.error}Saved states{/if}
  </p>
  {#if record.error}<p class="failure" role="alert">{record.error}</p>{/if}
  {#if record.result}
    <details class="receipt">
      <summary>Saved receipt</summary>
      <p class="ref">Saved state: {record.result.state}</p>
      <p class="ref">Git commit: {record.result.git_commit}</p>
      <p class="ref">Worktree: {record.result.worktree}</p>
      <p class="ref">Ref: {record.result.git_ref}</p>
    </details>
  {/if}
  <details open={expanded || !record.result}>
    <summary>Saved states{record.history.length ? ` (${record.history.length})` : ''}</summary>
    <button class="refresh" disabled={record.loading || record.saving} onclick={onrefresh}>Refresh</button>
    {#if record.loading}<p role="status">Loading saved states…</p>
    {:else if record.historyError}<p class="failure" role="alert">{record.historyError}</p>
    {:else if !record.loaded && !record.history.length}<p>Refresh to load saved states.</p>
    {:else if !record.history.length}<p>No saved states.</p>{/if}
    {#each record.history as saved, index (saved.state)}
      <details class="receipt">
        <summary>Saved state {index + 1} · {saved.files} {saved.files === 1 ? 'file' : 'files'}</summary>
        <p>{saved.bytes.toLocaleString()} bytes{created(saved.created) ? ` · Created: ${created(saved.created)}` : ''}</p>
        <p class="ref">{saved.state}</p>
        {#if saved.source_revision}<p class="ref">Source revision: {saved.source_revision}</p>{/if}
        <p class="ref">Manifest: {saved.manifest}</p>
        {#if saved.git_commit}<p class="ref">Git commit: {saved.git_commit}</p>
          <p class="ref">Worktree: {saved.worktree}</p>
          <p class="ref">Ref: {saved.git_ref}</p>{/if}
        <label>Restore destination
          <input aria-label={`Restore destination for saved state ${index + 1}`} value={destinations[saved.state] ?? restorePath(record.path, index)}
            oninput={event => destinations[saved.state] = event.currentTarget.value} />
        </label>
        <button disabled={record.saving || !!record.restoring} onclick={() => onrestore(saved, destinations[saved.state] ?? restorePath(record.path, index))}>
          {record.restoring === saved.state ? 'Restoring…' : 'Restore'}
        </button>
        {#if record.restoreResult?.state === saved.state}<p role="status">Restored {record.restoreResult.files} files to {record.restoreResult.destination}</p>{/if}
        {#if record.restoreError}<p class="failure" role="alert">{record.restoreError}</p>{/if}
      </details>
    {/each}
  </details>
</aside>

<style>
  .node-saves { position: fixed; right: 16px; bottom: 16px; z-index: 6; width: min(370px, calc(100vw - 32px)); max-height: min(460px, 70dvh); overflow: auto; padding: 12px; border: 1px solid var(--line-strong); border-radius: 9px; box-shadow: var(--shadow); background: var(--panel); color: var(--text); font-size: 12px; }
  header { display: flex; align-items: center; gap: 8px; }
  header strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header button { padding: 0 7px; font-size: 20px; }
  p { margin: 8px 0; overflow-wrap: anywhere; }
  summary { cursor: pointer; }
  .refresh { margin: 8px 0; padding: 4px 8px; }
  label { display: grid; gap: 4px; margin: 8px 0; color: var(--muted); }
  label input { min-width: 0; padding: 4px 6px; }
  .receipt { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
  .ref { color: var(--muted); font: 10px/1.5 ui-monospace, monospace; }
  .failure { color: var(--danger); }
</style>
