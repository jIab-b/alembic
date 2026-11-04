<script lang="ts">
  import {previewKind as classifyPreview} from '../../render/registry.js';
  import {loadViewer} from './contract/surface.js';
  import {onMount, tick} from 'svelte';
  import type {NodeClient} from './node.js';
  import {fileChanges, runFiles, commandTitle} from './shadow.js';
  import {sha256} from './history';
  import ShadowGraph from './ShadowGraph.svelte';
  let {client, path, onclose}: {client: NodeClient; path: string; onclose: () => void} = $props();
  let dialog: HTMLDialogElement, host: HTMLDivElement;
  let loading = $state(true), failure = $state(''), graphFailure = $state('');
  let runLimit = $state(20);
  let graph = $state<any>({nodes: [], artifacts: [], edges: []}), changes = $state<any[]>([]), count = $state(0);
  let selected = $state('live'), previewing = $state(false), previewError = $state(''), previewKind = $state('');
  let media = $state(''), text = $state(''), size = $state(0);
  let thumbnails = $state<Record<string, string>>({}), liveHash = $state(''), inspectedRun = $state('');
  let viewer: any, viewerPromise: Promise<any> | undefined, alive = true, loadId = 0, previewId = 0;
  let hasModel = false;
  const revision = $derived(changes.find(change => change.commit === selected));
  const focusedRun = $derived(inspectedRun ? (graph.nodes || []).find((node: any) => node.id === inspectedRun)
    || (() => { const change = changes.find(change => change.run === inspectedRun); return change ? {...change, cmd: change.command} : null; })() : null);
  const related = $derived((graph.nodes || []).filter((node: any) => !changes.some(change => change.run === node.id)));
  const files = $derived(inspectedRun || revision?.run ? runFiles(graph, inspectedRun || revision.run) : {inputs: [], outputs: []});
  const command = $derived(focusedRun?.cmd || revision?.command || '');
  function thumbnail(hash: string, bytes: Uint8Array, type = 'image/png') {
    if (thumbnails[hash]) return;
    const next = {...thumbnails};
    if (Object.keys(next).length >= 12) {
      const first = Object.keys(next)[0]; URL.revokeObjectURL(next[first]); delete next[first];
    }
    next[hash] = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type})); thumbnails = next;
  }
  function stamp(value: string | number) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
  }
  function releaseMedia() { if (media) URL.revokeObjectURL(media); media = ''; }
  async function inspectRun(run: string) {
    const capture = changes.find(change => change.run === run);
    if (capture && capture.commit !== selected) {
      const pending = preview(capture.commit), request = previewId;
      await pending;
      if (!alive || request !== previewId) return;
    }
    inspectedRun = run;
  }
  async function preview(commit: string) {
    const current = ++previewId;
    selected = commit; inspectedRun = ''; previewing = true; previewError = ''; text = ''; releaseMedia();
    const entry = changes.find(change => change.commit === commit);
    if (entry?.change === 'removed' || entry?.change === 'deleted') {
      previewKind = ''; previewing = false; previewError = 'This file was deleted in this snapshot.'; return;
    }
    try {
      const bytes = await client.file(path, commit);
      if (!alive || current !== previewId) return;
      const hash = 'sha256:' + await sha256(bytes);
      if (!alive || current !== previewId) return;
      if (commit === 'live') liveHash = hash;
      size = bytes.length;
      const extension = path.split('.').pop()?.toLowerCase() || '';
      previewKind = classifyPreview(path);
      if (previewKind === 'model') {
        await tick();
        viewerPromise ??= loadViewer().then(({createViewer}) => createViewer(host, () => {}, () => {}, undefined, undefined, {renderOnDemand: true}));
        const nextViewer = await viewerPromise;
        viewer = nextViewer;
        if (!alive || current !== previewId) return;
        // Every external model resource comes from the same immutable snapshot.
        await nextViewer.load(bytes, {read: (resource: string) => client.file(resource, commit)}, path, hasModel);
        if (!alive || current !== previewId) return;
        hasModel = true;
        if (!thumbnails[hash]) {
          const png = await nextViewer.crop({shape: 'area', area: [0, 0, 1, 1]});
          if (png && alive && current === previewId) thumbnail(hash, png);
        }
      } else if (previewKind === 'text') text = new TextDecoder().decode(bytes.subarray(0, 200000));
      else if (previewKind !== 'binary') {
        const type = extension === 'svg' ? 'image/svg+xml' : extension === 'jpg' ? 'image/jpeg'
          : `${previewKind}/${extension}`;
        media = URL.createObjectURL(new Blob([bytes], {type}));
        if (previewKind === 'image') thumbnail(hash, bytes, type);
      }
    } catch (error) { if (alive && current === previewId) previewError = (error as Error).message; }
    finally { if (alive && current === previewId) previewing = false; }
  }
  async function refresh() {
    const current = ++loadId;
    loading = true; failure = ''; graphFailure = '';
    // The history read follows the chosen window; only the local inspection shrinks, retained history never is.
    const results = await Promise.allSettled([client.log(runLimit), client.graph(path, '', runLimit)]);
    if (!alive || current !== loadId) return;
    const [history, lineage] = results;
    if (lineage.status === 'fulfilled') graph = lineage.value;
    else { graph = {nodes: [], artifacts: [], edges: []}; graphFailure = lineage.reason?.message || 'Run links unavailable'; }
    if (history.status === 'fulfilled') {
      count = history.value.length;
      changes = fileChanges(path, history.value, graph);
      loading = false;
      await preview(selected === 'live' || changes.some(change => change.commit === selected) ? selected : 'live');
    } else { failure = history.reason?.message || 'Shadow history unavailable'; loading = false; }
  }
  onMount(() => {
    dialog.showModal();
    void refresh();
    return () => {
      alive = false; loadId++; previewId++; releaseMedia();
      Object.values(thumbnails).forEach(url => URL.revokeObjectURL(url));
      viewerPromise?.then(instance => instance.dispose()).catch(() => {});
    };
  });
</script>

<dialog bind:this={dialog} aria-label={`Shadow tree for ${path}`} oncancel={event => { event.preventDefault(); onclose(); }}>
  <header>
    <div><strong>Shadow tree</strong><span class="path" title={path}>{path}</span></div>
    <button onclick={() => { void refresh(); }} disabled={loading}>Refresh</button>
    <button class="close" aria-label="Close shadow tree" onclick={onclose}>×</button>
  </header>
  <p class="intro">Recorded runs → file snapshots. Drag nodes to arrange, pan and zoom to explore. Historical previews are read-only.</p>
  <label class="intro">Run links:
    <select aria-label="Recent run window" bind:value={runLimit} disabled={loading} onchange={() => { void refresh(); }}>
      <option value={20}>Latest 20</option><option value={100}>Latest 100</option><option value={200}>Latest 200</option><option value={500}>Latest 500</option>
    </select>
    Larger windows take longer to load. Saved file history is retained.
  </label>
  <div class="body">
    <div class="graph-wrap">
      <ShadowGraph {path} {changes} {graph} {selected} {inspectedRun} {thumbnails} {liveHash}
        onpreview={commit => { void preview(commit); }} oninspect={run => { void inspectRun(run); }} />
      {#if loading}<p class="graph-status" role="status">Loading shadow history…</p>{/if}
      {#if failure}<p class="graph-status failure" role="alert">{failure}</p>{/if}
    </div>
    <section class="version" aria-label="Shadow version preview">
      <div class="version-heading"><strong>{selected === 'live' ? 'Live file' : 'Snapshot'}</strong><span>{size ? `${(size / 1024).toFixed(1)} KiB` : ''}</span></div>
      <div class="preview-stage">
        <div class="history-model" class:inactive={previewKind !== 'model' || !!previewError} bind:this={host}></div>
        {#if previewing}<p class="preview-status" role="status">Loading preview…</p>{/if}
        {#if previewError}<p class="preview-status failure" role="alert">{previewError}</p>
        {:else if previewKind === 'image' && media}<img src={media} alt={`${path} ${selected === 'live' ? 'current preview' : 'snapshot preview'}`} />
        {:else if previewKind === 'video' && media}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={media} controls aria-label="Historical video"></video>
        {:else if previewKind === 'audio' && media}<audio src={media} controls aria-label="Historical audio"></audio>
        {:else if previewKind === 'text'}<pre>{text}</pre>
        {:else if previewKind === 'binary'}<p class="note">Snapshot bytes are retained. This file type has no browser preview.</p>{/if}
      </div>
      <div class="details">
        {#if revision || focusedRun}
          <p><strong>{focusedRun?.actor || revision?.actor || 'Unknown actor'}</strong> · {stamp(focusedRun?.at ?? revision?.at)}{(focusedRun?.exit ?? revision?.exit) == null ? '' : ` · exit ${focusedRun?.exit ?? revision?.exit}`}</p>
          {#if command}<details open={!!focusedRun}><summary>Recorded command</summary><pre>{command.slice(0, 32000)}{command.length > 32000 ? '\n… command display truncated' : ''}</pre></details>{/if}
          {#if (!focusedRun && revision?.hash) || inspectedRun || revision?.run}<details><summary>Technical references</summary>
            {#if !focusedRun && revision?.hash}<p class="hash">{revision.hash}</p>{/if}
            {#if inspectedRun || revision?.run}<p class="hash">Run {inspectedRun || revision.run}</p>{/if}
          </details>{/if}
          {#if files.inputs.length || files.outputs.length}<details><summary>Linked files</summary>
            {#if files.inputs.length}<strong>Inputs</strong>{#each files.inputs as file}<p class="linked-file">{file}</p>{/each}{/if}
            {#if files.outputs.length}<strong>Recorded outputs</strong>{#each files.outputs as file}<p class="linked-file">{file}</p>{/each}{/if}
            <p class="note">Hash links can include copied files and overlapping runs.</p>
          </details>{/if}
        {:else}<p class="note">Click a version for an orbitable preview, or a run for its recorded command.</p>{/if}
        <p class="note limit">{changes.length} file captures{count === runLimit ? ` in the latest ${runLimit} project snapshots. Older history remains retained.` : ` across ${count} project snapshots.`}</p>
        {#if graph.window}
          <p class="note">Run links use a window of {graph.window.returned} recorded runs.
            {#if !graph.window.complete_lineage}Earlier producers may be outside this window. Older history remains retained.{/if}</p>
        {/if}
        {#if graphFailure}<p class="note">{graphFailure}. Captured file versions remain available.</p>{/if}
        {#if related.length}<details class="related"><summary>{related.length} related runs</summary>
          {#each related as node (node.id)}<div class="related-run"><strong>{commandTitle(node.cmd)}</strong>
            <small>{node.actor || 'Unknown actor'} · {stamp(node.at)}{node.exit === null || node.exit === undefined ? '' : ` · exit ${node.exit}`}</small>
            {#if node.cmd}<details><summary>Command</summary><pre>{node.cmd.slice(0, 32000)}</pre></details>{/if}
          </div>{/each}
        </details>{/if}
      </div>
    </section>
  </div>
</dialog>

<style>
  dialog { width: min(1600px, calc(100vw - 32px)); height: min(1000px, calc(100dvh - 40px)); max-width: none; max-height: none; padding: 0; color: var(--text); background: var(--panel); border: 1px solid var(--line-strong); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; }
  dialog[open] { display: flex; flex-direction: column; }
  dialog::backdrop { background: rgba(8, 12, 20, .55); }
  header { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  header > div { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
  .path { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
  button { padding: 7px 11px; }
  .close { font-size: 22px; padding: 2px 9px; }
  .intro { margin: 0; padding: 10px 18px; color: var(--muted); font-size: 12px; border-bottom: 1px solid var(--line); }
  .body { display: grid; grid-template-columns: minmax(0, 1fr) 350px; flex: 1; min-height: 0; }
  .graph-wrap { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .graph-wrap :global(.graph-panel) { flex: 1; }
  .graph-status { position: absolute; left: 20px; top: 60px; background: var(--panel); padding: 10px; border-radius: 7px; }
  small { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
  .version { min-height: 0; min-width: 0; display: flex; flex-direction: column; border-left: 1px solid var(--line); }
  .version-heading { display: flex; justify-content: space-between; padding: 12px 16px; gap: 10px; font-size: 12px; }
  .version-heading span { color: var(--muted); }
  .preview-stage { position: relative; min-height: 160px; flex: 1; background: var(--canvas); overflow: hidden; display: grid; place-items: center; }
  .history-model { position: absolute; inset: 0; }
  .history-model.inactive { visibility: hidden; pointer-events: none; }
  img, video { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
  audio { width: 90%; }
  .preview-stage > pre { position: absolute; inset: 0; padding: 14px; margin: 0; overflow: auto; }
  .preview-status { position: absolute; z-index: 2; background: var(--panel); padding: 10px 14px; border-radius: 8px; max-width: 90%; overflow-wrap: anywhere; }
  .details { max-height: 38%; overflow: auto; padding: 10px 16px; font-size: 12px; border-top: 1px solid var(--line); }
  .details p { margin: 6px 0; }
  .hash { color: var(--muted); font: 10px ui-monospace, monospace; overflow-wrap: anywhere; }
  details { margin: 8px 0; }
  summary { cursor: pointer; color: var(--soft-text); }
  pre { font: 11px/1.5 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .note { color: var(--muted); font-size: 11px; line-height: 1.6; padding: 4px; }
  .failure { color: var(--danger); }
  .limit { margin-top: 14px; }
  .linked-file { padding-left: 8px; font: 11px ui-monospace, monospace; overflow-wrap: anywhere; }
  .related-run { padding: 10px 0; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
  @media (max-width: 900px) { .body { grid-template-columns: minmax(0, 1fr) 280px; } header, .intro { padding: 10px; } }
  @media (max-width: 650px) { .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(180px, 1fr) minmax(180px, .8fr); } .version { border-left: 0; border-top: 1px solid var(--line); } }
</style>
