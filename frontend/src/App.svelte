<script lang="ts">
  import SpatialSurface from './contract/SpatialSurface.svelte';
  import Shell from './Shell.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import FileTree from './FileTree.svelte';
  import Row from './Row.svelte';
  import Areas from './Areas.svelte';
  import Handles from './Handles.svelte';
  import PromptNode from './PromptNode.svelte';
  import ReplayControls from './ReplayControls.svelte';
  import Playback from './Playback.svelte';
  import WebPlayback from './WebPlayback.svelte';
  import MediaPreview from './MediaPreview.svelte';
  import CanvasTabs from './CanvasTabs.svelte';
  import CanvasViews from './CanvasViews.svelte';
  import ShadowTree from './ShadowTree.svelte';
  import NodeSaves from './NodeSaves.svelte';
  import {createNodeSaves} from './node-saves.js';
  import type {NodeClient} from './node.js';
  import PromptMenu from './PromptMenu.svelte';
  import {createWorkspace} from './workspace.svelte';
  import {openNodeDocument} from './canvas.js';
  const v = createWorkspace();
  let showInfrastructure = $state(false);
  try { showInfrastructure = localStorage.getItem('alembic-show-infrastructure') === 'true'; } catch {}
  function toggleInfrastructure() {
    showInfrastructure = !showInfrastructure;
    try { localStorage.setItem('alembic-show-infrastructure', String(showInfrastructure)); } catch {}
  }
  let fileMenu = $state<{client: NodeClient; path: string; x: number; y: number} | null>(null), shadowPath = $state('');
  let saveRecords = $state<any[]>([]), saveTarget = $state<{client: NodeClient; path: string; history: boolean} | null>(null);
  const saves = createNodeSaves(record => {
    saveRecords = [...saveRecords.filter(row => row.client !== record.client || row.path !== record.path), record];
  });
  const saveRecord = $derived(saveTarget && saveRecords.find(row => row.client === saveTarget.client && row.path === saveTarget.path));
  const saveBusy = $derived(fileMenu && saveRecords.some(row => row.client === fileMenu.client && row.path === fileMenu.path && row.saving));
  function nodeSave(save: boolean) {
    if (!fileMenu) return;
    const {client, path} = fileMenu;
    saveTarget = {client, path, history: !save}; fileMenu = null;
    void (save ? saves.save(client, path) : saves.refresh(client, path));
  }
  function fileContext(path: string, event: MouseEvent) {
    if (!v.client) return;
    event.preventDefault(); event.stopPropagation(); v.menu = null;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    fileMenu = {client: v.client, path, x: Math.max(4, Math.min(event.clientX || box.left, innerWidth - 180)), y: Math.max(4, Math.min(event.clientY || box.bottom, innerHeight - 120))};
  }
  const {run, toggleTheme, view, drawScene, scrub, paint, open, choose, remove, reshape, nextId, add, openMenu, brew, label} = v;
  async function playChild() { throw new Error('Stream renderer is unavailable; a render-funnel adapter is required'); }
  async function playChildClip(path:string, viewId:string, index:number, name:string) {
    if (!v.folder) throw new Error('Project is unavailable');
    const {document}=await openNodeDocument(v.folder,path,true);
    const selected=document.nodes.find((n:any)=>n.id===viewId);
    if (!document.views.includes(viewId) || !selected || !/\.(glb|gltf)$/i.test(selected.path)) throw new Error('Child clip preview is unavailable');
    await v.open(path,true); await v.switchCanvasView(viewId);
    if (v.canvasPath!==path || v.canvasView!==viewId || !v.surface.model || v.animationClips[index]!==name) throw new Error('The child clip is no longer available');
    v.chooseAnimation(index);
  }
</script>

<svelte:head><title>{v.folder?.name.split('/').pop() || 'Alembic'}</title></svelte:head>

{#snippet playbackControls()}
  {#if v.replay.available || v.folder && (v.canvas || v.animationClips.length)}
    <div class="playback-row"><div class="playback-controls">
      {#if v.folder && v.canvas?.canonical}{#key `${v.canvasPath}:${v.canvasView}`}<WebPlayback folder={v.folder} path={v.canvasPath} canvas={v.canvas} selected={v.canvasView} ready={!!v.webReady} playing={v.webPlaying} error={v.webError} onplay={v.playWebScenario} onreset={v.resetWebScenario} />{/key}
      {:else if v.folder && (v.canvas || v.animationClips.length)}{#key v.canvasPath || v.documentPath}<Playback folder={v.folder} path={v.canvasPath} clips={v.animationClips} currentClip={v.replay.snapshot().clip || ''}
        onclip={v.chooseAnimation} onaction={()=>{}} onchild={()=>{void run(playChild)}} onchildclip={(path,view,index,name)=>{void run(()=>playChildClip(path,view,index,name))}} />{/key}{/if}
      <ReplayControls replay={v.replay} showUnavailable={!!v.canvas} />
    </div></div>
  {/if}
{/snippet}

<svelte:window onkeydown={event => {
  if ((event.target as Element).closest('.chat')) return;
  if (event.key==='F3' && !(event.target as Element).closest('input,textarea,[contenteditable=true]')) {
    event.preventDefault();void v.toggleInteraction('io_lock').catch(cause=>v.error=cause.message);return;
  }
  if (event.key === 'Escape') {
    if(v.interactionPending||v.interactionState?.io_lock){event.preventDefault();v.releaseInteraction();return}
    if (v.webPlaying) { event.preventDefault(); void v.resetWebScenario().catch(message => v.error = message.message); return; }
    if (shadowPath) { shadowPath = ''; return; }
    if (fileMenu) { fileMenu = null; return; }
    if (saveTarget) { saveTarget = null; return; }
    if (v.menu) { v.menu = null; }
    else if (v.tool) { v.tool = ''; v.viewer?.tool(''); } else { v.active = ''; paint(); }
  } else if (!v.minimal && !shadowPath && (event.key === 'Delete' || event.key === 'Backspace') && v.active && !(event.target as Element).closest('input, textarea')) {
    const id = v.active; event.preventDefault(); void run(() => remove(id));
  }
}} onpointerdown={event => { if (v.menu && !(event.target as Element).closest('.menu')) v.menu = null;
  if (fileMenu && !(event.target as Element).closest('.file-menu')) fileMenu = null; }} />
<Shell minimal={v.minimal} theme={v.theme} popup={v.popup} {toggleTheme} chatReveal={v.chatReveal}>
  {#snippet promptMenu(compact)}<PromptMenu mode={v.canvasPromptMode} onchange={v.setCanvasPromptMode} {compact}
    autoOpenRenderTabs={v.autoOpenRenderTabs} onrenderchange={v.setAutoOpenRenderTabs} />{/snippet}
  {#snippet tabs()}<CanvasTabs tabs={v.tabs} active={v.activeTab} onselect={id => { void run(() => v.switchTab(id)); }}
    onclose={id => { void run(() => v.closeTab(id)); }} onnew={() => { void run(v.newTab); }} onfilemenu={fileContext}
    renderPath={v.latestRender?.path || ''} onrender={() => { void run(() => v.openRenderPreview()); }} />{/snippet}
  {#snippet files()}
      {#if v.folder?.writable}
      <button class="tree-visibility" aria-pressed={showInfrastructure} onclick={toggleInfrastructure}>{showInfrastructure ? 'Hide internal files' : 'Show internal files'}</button>
        <Row folder expanded={v.rootOpen} label={v.folder.name || 'Folder'} onclick={() => v.rootOpen = !v.rootOpen} />
        {#if v.rootOpen}{#key v.folder}<FileTree folder={v.folder} {showInfrastructure} depth={1} active={v.documentPath} open={(path, directory) => { void run(() => open(path, directory)); }} onfilemenu={fileContext} />{/key}{/if}
      {/if}
  {/snippet}
  {#snippet agent(open, ontoggle)}
    <ChatPanel client={v.client} project={v.folder?.name||'workspace'} nativeDraft={v.nativeDraft} onclearNativeDraft={v.clearNativeDraft} onpromptready={v.bindTerminalPrompt} agents={v.agents} checking={v.agentsChecking} issue={v.agentIssue} {open} {ontoggle} />
  {/snippet}

    <div class="preview">
    {#if v.file && v.kind !== 'other' && (!v.minimal || v.canvas || v.replay.available)}<aside class="selection-pane" class:scene-views={!!v.canvas} aria-label="Highlights">
      {#if !v.minimal}<div class="canvas-tools"><div class="canvas-tools-inner">
      <div class="selection-controls">
      {#if v.spatialPrompts}<span class="experiment-label" title="Experimental spatial prompts; remove experiment=spatial-prompts from the URL to disable">Experimental</span>{/if}
      <div class="tools" role="toolbar" aria-label="Selection tools">
        {#each v.spatialSupported ? v.tools.filter(([shape]) => v.shapeMode !== 'real' || ['sphere', 'box'].includes(shape)) : v.tools.slice(0, 1) as [shape, icon]}<button disabled={!!v.interactionState?.io_lock} class:active={v.tool === shape} aria-pressed={v.tool === shape} aria-label={shape} title={shape}
          onclick={() => { v.replay.pause(); v.menu = null; v.parkPrompt(); v.tool = v.tool === shape ? '' : shape; v.viewer?.tool(v.tool === 'area' ? '' : v.tool); }}><svg viewBox="0 0 16 16"><path d={icon} /></svg></button>{/each}
      </div>
      {#if v.realSupported}<button class="shape-mode" aria-label="Shape mode" title="Switch shape mode"
        onclick={() => v.setShapeMode(v.shapeMode === 'real' ? 'prompt' : 'real')}>{v.shapeMode === 'real' ? 'Solid' : 'Prompt'}</button>{/if}
      </div>
      </div></div>{/if}
      {#if v.canvas}<CanvasViews canvas={v.canvas} selected={v.canvasView}
        permissions={v.interactionPermissions} interaction={v.interactionState} oninteraction={mode=>{void v.toggleInteraction(mode).catch(cause=>v.error=cause.message)}}
        onchange={id => { void run(() => v.switchCanvasView(id)); }} />{/if}
      {@render playbackControls()}

    </aside>{/if}
    <div class="viewport" bind:this={v.viewport} onpointerdowncapture={event => {
      if (v.tool || v.active) v.replay.pause();
    }}>
      <div class="scene" class:inactive={!v.surface.model || !!shadowPath} bind:this={v.host}></div>
      {#if v.kind === 'svg' || v.kind === 'video' || v.kind === 'audio'}{#key v.image}<MediaPreview src={v.image} svg={v.kind === 'svg'} audio={v.kind === 'audio'} title={v.file} replay={v.replay} onready={v.restoreTabReplay} onerror={message => v.error = message} />{/key}
      {:else if v.kind === 'image'}<img src={v.image} alt={v.file} onerror={event => { if ((event.currentTarget as HTMLImageElement).src === v.image) v.error = `Cannot decode ${v.file}`; }} />
      {:else if v.kind === 'text'}<pre>{v.text}</pre>
      {:else if v.surface.app && v.frame}{#key v.frame}<iframe src={v.frame} title={v.file} bind:this={v.frameEl} inert={v.surface.lightIframe && !v.interactionState?.io_lock} style:visibility={!v.surface.lightIframe && v.canvas && !v.interactionState?.configured ? 'hidden' : 'visible'} style:pointer-events={(v.surface.media || v.surface.lightIframe) && !v.interactionState?.io_lock ? 'none' : 'auto'} allow="fullscreen; gamepad; autoplay; pointer-lock"></iframe>{/key}
      {:else if v.surface.runtime && v.frame}<iframe src={v.frame} title={v.file} bind:this={v.frameEl} onload={() => {
        if (v.frameEl?.contentWindow) v.adapter?.frame?.(v.frameEl.contentWindow, hit => { void run(() => v.pick(hit)); });
        v.frameLoaded(); paint();
      }}></iframe>
      {:else if v.kind === 'other'}<p class="welcome">No preview</p>
      {:else if !v.file}<p class="welcome">Files</p>
      {/if}
      <SpatialSurface {v} />
      {#if !v.minimal && !v.interactionState?.io_lock && v.spatialSupported}
        <Handles viewer={v.spatialViewer} volumes={v.visible.filter(s => s.center && s.shape !== 'area')} active={v.active} enabled={!v.tool} onselect={choose}
          ondelete={v.spatialPrompts ? id => { void run(() => remove(id)); } : undefined}
          onchange={(next, done) => { void reshape(next, done); }} onmenu={(id,x,y)=>{void run(()=>openMenu(id,x,y))}} />{/if}
      {#if v.file && v.kind !== 'other'}
        {#if !v.minimal && !v.interactionState?.io_lock}<Areas areas={v.visible.filter(s => s.shape === 'area')} active={v.active} armed={v.tool === 'area'} grab={true} onselect={choose}
          ondraw={area => { v.tool = ''; void run(async () => {
            const id = nextId();
            await add({id, tag: '', shape: 'area', area, objects: [], crop: null});
          }); }}
          onchange={(id, area, done) => { const s = v.selections.find(x => x.id === id); if (s) void reshape({...$state.snapshot(s), area}, done); }}
          onmenu={(id,x,y)=>{void run(()=>openMenu(id,x,y))}} />{/if}
        <div class="top">
        {#if v.session}<div class="tools views" role="toolbar" aria-label="Views">
          {#if !v.appMode}{#each v.session.views as name}<button class:active={v.sceneView === name}
            onclick={() => run(async () => { v.sceneView = name; await drawScene(false); })}>{name === 'sm100' ? 'SM100' : name}</button>{/each}
            {#if v.session.cycles && v.sceneView === 'sm100'}<input class="cycle" type="range" min="0" max={v.session.cycles} value={v.cycle}
              aria-label="Cycle" oninput={event => scrub(Number(event.currentTarget.value))} /><span class="cycle-label">{v.cycle}</span>{/if}{/if}
          <button onclick={() => run(async () => { v.appMode = !v.appMode; await v.toggleApp(); })}>{v.appMode ? 'Scene' : 'App'}</button>
        </div>{/if}
      </div>
      {/if}
      {#if v.menu && !v.popup}{@const at = v.menu}<div class="menu" role="menu" style:left="{at.x}px" style:top="{at.y}px">
        <button role="menuitem" onclick={() => { void run(v.promptMenu); }}>Prompt</button>
        {#if at.id}<button role="menuitem" onclick={() => { void run(() => remove(at.id)); }}>Delete</button>{/if}
      </div>{/if}
      {#each v.popup ? [] : v.promptNodes as prompt (prompt.id)}{@const selection = v.selections.find(s => s.id === prompt.id)}
        <PromptNode highlight={prompt.id} x={prompt.x} y={prompt.y} ax={prompt.ax} ay={prompt.ay} phase={prompt.state} note={prompt.note} bind:text={prompt.text}
          projectAnchor={() => {
            if (v.spatialSupported && selection?.center && v.spatialViewer) return v.spatialViewer.project(selection.center);
            if (selection?.area && v.viewport) { const box = v.viewport.getBoundingClientRect(), [x, y, w, h] = selection.area; return [(x + w / 2) * box.width, (y + h / 2) * box.height]; }
            return [prompt.ax, prompt.ay];
          }}
          projectCard={v.spatialPrompts && prompt.point && !prompt.dragged ? () => {
            const point = v.spatialViewer?.project(prompt.point!);
            if (!point) return null;
            const unit = v.spatialViewer.dragFrame(prompt.point!).scale;
            return [...point, Math.max(.4, Math.min(1.6, (prompt.unit || unit) / unit))];
          } : undefined}
          disabled={v.canvasPromptDisabled} result={prompt.result || ''}
          onsend={text => { void brew(text, prompt.id); }} onclose={() => { void run(() => v.closePrompt(prompt.id)); }}
          onmove={(x,y) => v.movePrompt(prompt.id,x,y)} />{/each}
    </div>
    </div>
    {#if v.error}<div class="status" role="alert">{v.error}</div>{/if}
    {#if fileMenu}<div class="menu file-menu" role="menu" aria-label="File actions" style:left="{fileMenu.x}px" style:top="{fileMenu.y}px">
      <button role="menuitem" disabled={!!saveBusy} onclick={() => nodeSave(true)}>Save</button>
      <button role="menuitem" onclick={() => nodeSave(false)}>Saved states</button>
      <button role="menuitem" onclick={() => { shadowPath = fileMenu!.path; fileMenu = null; }}>Shadow tree</button>
    </div>{/if}
    {#if saveRecord}<NodeSaves record={saveRecord} expanded={saveTarget?.history} onclose={() => saveTarget = null}
      onrestore={(saved, destination) => { const {client, path} = saveRecord; void saves.restore(client, path, saved.state, destination); }}
      onrefresh={() => { const {client, path} = saveRecord; void saves.refresh(client, path); }} />{/if}
    {#if shadowPath && v.client}{#key shadowPath}<ShadowTree client={v.client} path={shadowPath} onclose={() => shadowPath = ''} />{/key}{/if}
</Shell>

<style>
  .playback-row { position: absolute; top: 50%; transform: translateY(-50%); left: 0; width: 100%; display: flex; justify-content: center; min-width: 0; pointer-events: none; }
  .playback-controls { display: flex; align-items: center; gap: 2px; width: max-content; min-width: 0; max-width: max(180px, calc(100% - 340px)); height: 28px; padding: 0 6px; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--field); pointer-events: auto; }
  .playback-controls :global(.transport) { border: 0; padding: 0; background: transparent; flex-wrap: nowrap; }
  .playback-controls :global(.playback-menu) { flex: none; }
  .playback-controls :global(.playback-menu summary) { display: flex; align-items: center; gap: 6px; padding: 2px 5px; border: 0; list-style: none; }
  .playback-controls :global(.playback-menu summary::marker) { content: ''; }
  .playback-controls :global(.playback-menu summary::-webkit-details-marker) { display: none; }
  @container (max-width: 540px) {
    .playback-row { position: static; transform: none; flex: 0 0 100%; }
    .playback-controls { max-width: 100%; }
  }
  .tree-visibility { margin: 4px 8px; padding: 4px 6px; font-size: 11px; color: var(--muted); background: transparent; }
  .experiment-label { color: var(--muted); font-size: 9px; padding-right: 6px; }
</style>
