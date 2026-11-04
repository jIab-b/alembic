<script lang="ts">
  import FileTree from './FileTree.svelte';
  import Row from './Row.svelte';
  import {isNodePackage} from './node-saves.js';
  import type {Entry, Folder} from './folder';
  // One directory level; subfolders list only when expanded, so large projects stay cheap.
  // Refresh expanded directories so files created by the CLI agent appear without refocusing the browser.
  let {folder, dir = '', depth = 0, active, open, onfilemenu, showInfrastructure = false}: {
    folder: Folder; dir?: string; depth?: number; active: string; showInfrastructure?: boolean; open: (path: string, directory?: boolean) => void;
    onfilemenu?: (path: string, event: MouseEvent) => void
  } = $props();
  // Large directories render 300 rows at a time; the last row shows more.
  let entries = $state<Entry[]>([]), expanded = $state<Record<string, boolean>>({}), shown = $state(300);
  $effect(() => {
    const current = folder, path = dir, reveal = showInfrastructure;
    let live = true;
    const load = () => current.list(path, reveal).then(list => { if (live) entries = list; }, () => { if (live) entries = []; });
    load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 2500);
    addEventListener('focus', load);
    return () => { live = false; clearInterval(timer); removeEventListener('focus', load); };
  });
</script>
{#each entries.slice(0, shown) as entry (entry.name)}
  {@const path = dir ? `${dir}/${entry.name}` : entry.name}
  {@const node = entry.directory && isNodePackage(path)}
  <Row {depth} folder={entry.directory} {node} expanded={expanded[path]} active={path === active} label={entry.name} title={path}
    oncontextmenu={(!entry.directory || node) && onfilemenu ? event => onfilemenu?.(path, event) : undefined}
    onexpand={node ? () => expanded[path] = !expanded[path] : undefined}
    onclick={() => entry.directory && !node ? expanded[path] = !expanded[path] : open(path, entry.directory)} />
  {#if entry.directory && expanded[path]}<FileTree {folder} dir={path} depth={depth + 1} {active} {open} {onfilemenu} {showInfrastructure} />{/if}
{/each}
{#if entries.length > shown}<button class="row more" style:--depth={depth} onclick={() => shown += 300}>{entries.length - shown} more</button>{/if}
