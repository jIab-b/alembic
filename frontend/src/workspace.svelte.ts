import {promptJobs} from './contract/prompt-jobs.js';
import {webSurface,loadViewer,mediaEntry,checkedHTML,surfaceFor,shapeStyle} from './contract/render';
import {onMount} from 'svelte';
import {NodeClient, tabConnection} from './node.js';
import {preparePreview, runtimeExecutor, discoverPreview} from './preview.js';
import {readPreviewFile} from './preview-file.js';
import {renderNotice} from './render.js';
import {readCanvas, readNode, readView, isTypedNode, openNodeDocument, resolveNodePath} from './canvas.js';
import {readPlaybacks, resolveWebPath, readExports} from './node-contract.js';
import {container, keys} from './gltf.js';
import {editSolid, isSolid, readSolids, solidLabel} from './solids.js';
import {nodeFolder, optionalRead, projectName, type Folder} from './folder';
import {sessionKey, mergeSession, commandSession} from './agents.js';
import {decode, encode, sha256, type Selected, type Selection} from './history';
import {type RuntimeCommands} from './terminal/backends';
import {createReplay} from './replay.svelte';
import type {Moment} from './replay.svelte';
import type {CanvasTab} from './CanvasTabs.svelte';
export function createWorkspace() {
  const minimal = new URLSearchParams(location.search).get('layout') === 'minimal';
  type Viewer = Awaited<ReturnType<Awaited<ReturnType<typeof loadViewer>>['createViewer']>>;
  // A runtime is a vendored bundle (tools/import-runtime.mjs) that opens files whose JSON "format" it declares;
  // with an adapter (runtimes/<name>.adapter.js) Alembic draws its scenes itself, otherwise it embeds the app.
  type Runtime = {name: string; formats: string[]; open: string; adapter?: string};
  type Session = {views: string[]; cycles: number; scene(view: string, cycle?: number, selected?: number | null): Uint8Array;
    objects(view: string, volume: Partial<Selection>): Selected[]; has(event: number): boolean;
    describe(event: number): Promise<unknown>; close(): void; terminal?: RuntimeCommands};
  type Adapter = {up: string; worker?: string; open(bytes: Uint8Array, execute?: any): Promise<Session>;
    frame?(win: Window, onPick: (object: Selected) => void): void; highlight?(win: Window, events: number[]): void};
  let folder = $state<Folder | null>(null), client = $state<NodeClient | null>(null);
  let agents = $state<string[]>([]), agentIssue = $state('Checking installed agents…'), lastAgentDiscovery = 0;
  let agentsChecking=$state(true);
  let rootOpen = $state(true);
  let runtimes: Runtime[] = [], adapters: Record<string, Adapter> = {}, adapter: Adapter | null = null;
  let session = $state<Session | null>(null), sceneView = $state(''), cycle = $state(0), appMode = $state(false), scrubbing = false;
  let runtimeRevision = $state(0);
  let frame = $state(''), frameFile = '', frameEl = $state<HTMLIFrameElement>(), appRoot = '', appSession = '', lit = '';
  let surface = $state<any>({});
  let startingRender = '';
  let webReady = $state<any>(null), webPlaying = $state(false), webError = $state(''), webInspectRevision = 0;
  let canvasDependencies: Record<string,{path?:string}> = {};
  const webDependencyCache = new Map<string,Promise<Record<string,{path?:string}>>>();
  const webRequests = new Map<string,{resolve:(value?:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  let interactionState=$state<any>(null), interactionEpoch=0, interactionPending=$state(false);
  const interactionPermissions=()=>surface.lightIframe ? {io_lock:true}
    : canvas?.nodes.find((node:any)=>node.id===canvasView)?.interaction || {io_lock:false};
  function updateInteraction(state:any) {
    const allowed=interactionPermissions();
    if(!state || typeof state.io_lock!=='boolean' ||
      state.io_lock && (!allowed.io_lock || state.capabilities?.io_lock!==true))
      throw Error('Invalid runtime interaction state');
    interactionState=state; paint();
  }
  async function setInteraction(patch:object) {
    const epoch=++interactionEpoch;
    for(const [key,value] of Object.entries(patch))if(key!=='io_lock' || typeof value!=='boolean' ||
      value && (!interactionPermissions().io_lock || interactionState?.capabilities?.io_lock!==true))
      throw Error('This node does not allow that interaction');
    if((patch as any).io_lock){tool='';viewer?.tool('');menu=null}
    if (surface.lightIframe) {
      updateInteraction({...interactionState,...patch});
      if ((patch as any).io_lock) {
        frameEl?.focus();
        frameEl?.contentWindow?.postMessage({type:'alembic.iframe.focus',session:appSession},playOrigin());
      }
      return;
    }
    if(Object.values(patch).some(Boolean))frameEl?.focus();
    interactionPending=true;
    try {
      const state=await webCall('alembic.web.interaction',patch);
      if(epoch===interactionEpoch)updateInteraction({...state,configured:true});
    } catch(cause) {
      if(epoch===interactionEpoch&&(cause as any).interactionState)updateInteraction((cause as any).interactionState);
      throw cause;
    } finally {if(epoch===interactionEpoch)interactionPending=false}
  }
  let interactionGesture:any=null;
  const toggleInteraction=(key:'io_lock')=>{
    const recent=interactionGesture?.key===key && performance.now()-interactionGesture.at<500;
    const state=recent ? interactionGesture.state : interactionState; interactionGesture=null;
    return setInteraction({[key]:!state?.[key]});
  };
  function releaseInteraction(dispose=false) {
    const epoch=++interactionEpoch;
    interactionPending=false;
    if (surface.lightIframe) {
      if (interactionState) updateInteraction({...interactionState,io_lock:false});
      if (dispose) interactionState=null;
      return;
    }
    const release=webReady&&appSession ? webCall('alembic.web.interaction',{io_lock:false}) : null;
    if(release)void release.then(state=>{if(!dispose&&epoch===interactionEpoch)updateInteraction({...state,configured:true})}).catch(cause=>{if(!dispose&&epoch===interactionEpoch){if(cause.interactionState)updateInteraction(cause.interactionState);error=cause.message}});
    if(dispose)interactionState=null
  }
  let animationClips = $state<string[]>([]);
  let webViewer=$state<any>(null);
  const spatialViewer = () => webViewer || (surface.model ? viewer : null);
  // Files the embedded app has loaded, with their size:lastModified then; a change to any of them reloads it.
  let loaded = new Map<string, string>();
  const assetBase = new URL(import.meta.env.BASE_URL, location.href);
  const asset = (path: string) => new URL(path, assetBase).href;
  let previewServer = '';
  const playURL = () => previewServer ? new URL('/assets/play/index.html', previewServer).href : asset('assets/play/index.html');
  const playOrigin = () => new URL(playURL()).origin;
  function webCall(type:string, body:object = {}) {
    if (surface.model && webReady) return viewer.command(type, body);
    if (!webReady || !appSession || !frameEl?.contentWindow) return Promise.reject(new Error('Web preview is not ready'));
    const id = crypto.randomUUID();
    return new Promise<any>((resolve,reject) => {
      const timer = setTimeout(() => {webRequests.delete(id);reject(new Error('Web preview did not respond'))},10000);
      webRequests.set(id,{resolve,reject,timer});
      frameEl!.contentWindow!.postMessage({type,id,session:appSession,...$state.snapshot(body)},playOrigin());
    });
  }
  let webClockTimer:ReturnType<typeof setTimeout>|undefined, detachWebClock:(()=>void)|null=null;
  function stopWebClock() {clearTimeout(webClockTimer);detachWebClock?.();detachWebClock=null}
  // A row's length drives the timeline on every renderer. Scripts are opaque and can't seek, so a drag snaps back to real time.
  function startWebClock(duration:number, play:()=>Promise<any>, reset:()=>Promise<void>) {
    let started:number|null=null;
    const elapsed=()=>started===null ? 0 : (performance.now()-started)/1000;
    let live=true;
    const resume=()=>{if(live&&started!==null&&elapsed()<duration-.001)void replay.play()};
    const detach=replay.attach({duration,currentTime:elapsed,seek:()=>{queueMicrotask(resume)},play:async()=>{
      if(started!==null)return;
      await play();if(!live)return;started=performance.now();
      if(Number.isFinite(duration))webClockTimer=setTimeout(()=>{void run(reset)},duration*1000);
    }});
    detachWebClock=()=>{live=false;detach()};
  }
  async function playWebScenario(name:string) {
    stopWebClock();
    if(webPlaying) {
      const reload=surface.media && /\.html$/i.test(file);
      await webCall('alembic.web.reset');
      if(reload){webReady=null;for(let i=0;!webReady && i<100;i++)await new Promise(resolve=>setTimeout(resolve,100));}
    }
    if (!canvas?.canonical || !canvasPath || !folder || !webReady) throw new Error('Web preview is not ready');
    const rows = readPlaybacks(await folder.read(canvasPath+'/playbacks.txt'),canvas);
    const scenario = rows.find((row:any)=>row.id===name);
    if(!scenario)throw new Error('Playback binding is unavailable');
    startingRender ||= canvasView;
    if(scenario.render!==canvasView) {
      await switchCanvasView(scenario.render);
      for(let i=0;!webReady && i<100;i++)await new Promise(resolve=>setTimeout(resolve,100));
    }
    if (!webReady || scenario.script===undefined && !webReady.scenarios.includes(name)) throw new Error('Playback binding is unavailable');
    if (scenario.seek==='runtime' && !webReady.seek?.includes(name)) throw new Error('This playback does not support seek');
    const uses:{instance:string;dependency:string;playback:string}[]=[];
    for (const use of scenario.uses as typeof uses) {
      const declared=canvasDependencies[use.dependency];
      if (!declared || typeof declared.path!=='string') throw new Error(`Missing declared dependency ${use.dependency}`);
      const child=resolveNodePath(canvasPath,declared.path);
      if (child===canvasPath || !isTypedNode(child)) throw new Error('Playback child must be a separate typed node');
      const childDoc=(await openNodeDocument(folder,child,true)).document;
      readExports(await folder.read(child+'/exports.txt'),child,{child:true});
      if (!childDoc.canonical || !readPlaybacks(await folder.read(child+'/playbacks.txt'),childDoc).some((row:any)=>row.id===use.playback))
        throw new Error(`Missing child playback ${use.playback}`);
      uses.push(use);
    }
    const revision=webInspectRevision;
    startWebClock(scenario.duration??Infinity,()=>webCall('alembic.web.play',{scenario:name,duration:scenario.duration,context:{uses},...(scenario.script===undefined ? {} : {script:scenario.script})}),()=>playWebScenario(name));
    webPlaying=webInspectRevision===revision;
  }
  async function resetWebScenario() {
    stopWebClock();webInspectRevision++;
    if (!webReady) {webPlaying=false;return}
    await webCall('alembic.web.reset'); webPlaying=false;
    if (startingRender && canvasView!==startingRender) await switchCanvasView(startingRender);
    startingRender='';replay.reset();
  }
  let file = $state(''), backend = $state('Initializing'), kind = $state(''), text = $state(''), image = $state('');
  let selections = $state<Selection[]>([]);
  let canvas = $state<any>(null), canvasPath = $state(''), canvasView = $state('');
  let canvasSource = '', canvasDirectory = false;
  let canvasSha = '', foreground = 0;
  const documentPath = $derived(canvasPath || file);
  const viewStates = new Map<string, TabState>();
  let theme = $state('dark');
  let error = $state(''), tool = $state<'' | 'area' | 'sphere' | 'box' | 'pick'>(''), active = $state('');
  let shapeMode = $state<'prompt' | 'real'>('prompt');
  type CanvasPromptMode = 'new-session' | 'chat';
  let canvasPromptMode = $state<CanvasPromptMode>('chat');
  let autoOpenRenderTabs = $state(false), latestRender = $state<{id: string; path: string} | null>(null);
  let renderFolder: Folder | null = null, seenRender = '', openedRenders = new Set<string>();
  let manifestStamp = '', manifestReadAt = 0;
  const replay = createReplay(message => error = message);
  let host = $state<HTMLDivElement>(null!);
  let viewer = $state<Viewer>(null!), viewport = $state<HTMLDivElement>();
  let tabs = $state<CanvasTab[]>([]), activeTab = $state(''), canvasNumber = 0;
  let pendingReplay: Moment | null = null;
  let liveBytes = new Uint8Array(), shownBytes: Uint8Array = new Uint8Array(), liveSha = '', signature = '', work = Promise.resolve();
  let statError = '', polling = false, lastFileCheck = 0;
  let sessionError = '', listing: Promise<void> | null = null;
  let ready: Promise<void>, timer: ReturnType<typeof setInterval>, sessionTimer: ReturnType<typeof setInterval>, disposed = false;
  const popup = null;
  // Right-clicking a highlight opens Prompt, a node wired to where it was clicked,
  // which sends the selected context to the host agent. Positions are viewport pixels.
  let menu = $state<{id: string; x: number; y: number; point?: number[]; hit?: Selected | null} | null>(null);
  const spatialPrompts = new URLSearchParams(location.search).get('experiment') === 'spatial-prompts';
  type PromptAsk = {id: string; x: number; y: number; ax: number; ay: number; state: 'edit' | 'brew' | 'done' | 'fail'; note: string; text: string; result?: string; request?: string; point?: number[]; unit?: number; hidden?: boolean; dragged?: boolean; context?: PromptContext};
  let ask = $state<PromptAsk | null>(null), parkedAsks = $state<PromptAsk[]>([]), spatialIds = $state<string[]>([]);
  const temporaryHighlights = new Set<string>();
  const promptNodes = $derived([...parkedAsks, ...(ask ? [ask] : [])].filter(node => !node.hidden));
  type TabState = {id: string; folder: Folder; path: string; directory?: boolean; bytes: Uint8Array;
    selections: Selection[]; active: string; detached: string[]; moment?: Moment; camera?: ReturnType<Viewer['replayPose']>;
    sceneView: string; cycle: number; appMode: boolean; ask: typeof ask; parkedAsks?: PromptAsk[]; spatialIds?: string[]; sha256: string; runtime: Session | null; canvasView?: string};
  const tabStates = new Map<string, TabState>();
  const closedRuntimes = new WeakSet<Session>();
  function closeRuntime(runtime: Session | null) {
    if (runtime && !closedRuntimes.has(runtime)) { closedRuntimes.add(runtime); runtime.close(); }
  }
  function detachRuntime() {
    if (session && ![...tabStates.values()].some(state => state.runtime === session)) closeRuntime(session);
    session = null;
  }
  const linked = $derived(client !== null);
  type AgentSession = {id?: string; pid?: number; agent: string; external: boolean; last_command?: number};
  let agentRows = $state<AgentSession[]>([]), selectedAgent = $state('');
  const selectedSession = $derived(agentRows.find(row => sessionKey(row) === selectedAgent));
  type ChatLine = {from: 'you' | 'agent' | 'error' | 'tool' | 'output' | 'status' | 'raw'; text: string; sessionId?: string};
  let chatLog = $state<ChatLine[]>([]), variant = $state(''), replying = $state(false), dropped = false, chatEpoch = 0;
  let nativeDraft = $state('');
  let terminalPrompt:((text:string)=>Promise<void>)|null=null;
  let jobs: Awaited<ReturnType<typeof promptJobs>> | undefined;
  let conversation = {variant: '', id: ''};
  type PromptContext = {file: string; sha256: string; canvasId: string; selection: Selection; canvas?: any; source?: string; editTargets?: string[]};
  let chatReveal = $state(0);
  const tools: ['area' | 'sphere' | 'box' | 'pick', string][] = [['area', 'M2 3.5h12v9H2z'], ['sphere', 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M2.5 8c0 1.4 2.5 2.4 5.5 2.4s5.5-1 5.5-2.4'],
    ['box', 'M8 2 13.5 5v6L8 14 2.5 11V5zM2.5 5 8 8l5.5-3M8 8v6'], ['pick', 'M8 6a2 2 0 1 0 0 4a2 2 0 1 0 0-4']];
  let detached = $state<string[]>([]);
  const chips = $derived(selections.filter(s => s.id === active && !isSolid(s) && !detached.includes(s.id))
    .map(s => ({id: s.id, label: solidLabel(s)})));
  const canvasPromptDisabled = $derived(spatialPrompts || canvasPromptMode !== 'chat' ? 'Use Continue chat with the sandbox terminal'
    : agents.includes(variant) ? '' : agentIssue || 'No supported agents are installed');
  async function availableAgents(node: NodeClient) {
    try {
      agents = await node.sandboxAgents();
      agentIssue = agents.length ? '' : 'No supported agents are installed in this Vault.';
    } catch (cause) {
      agents = [];
      agentIssue = `Sandbox agent discovery failed: ${(cause as Error).message}`;
    }
    agentsChecking=false;
    if (!agents.includes(variant)) variant = agents[0] || '';
  }
  function saveSetting(key: string, value: unknown) {
    try {
      let saved: Record<string, unknown> = {};
      try { const value = JSON.parse(localStorage.getItem('alembic-settings') || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) saved = value; } catch {}
      localStorage.setItem('alembic-settings', JSON.stringify({...saved, [key]: value}));
    } catch {}
  }
  function setCanvasPromptMode(mode: CanvasPromptMode) {
    if (!['new-session', 'chat'].includes(mode)) return;
    canvasPromptMode = mode; saveSetting('canvasPromptMode', mode);
  }
  function setAutoOpenRenderTabs(enabled: boolean) {
    autoOpenRenderTabs = Boolean(enabled); saveSetting('autoOpenRenderTabs', autoOpenRenderTabs);
  }
  const current = $derived(selections.find(s => s.id === active));
  // Prompt overlays belong to the current interaction; saved annotations stay out of the way.
  const finishedHighlights = $derived([...parkedAsks, ...(ask ? [ask] : [])].filter(node => node.state === 'done' && node.hidden).map(node => node.id));
  const visible = $derived(selections.filter(s => !finishedHighlights.includes(s.id) && (s.id === active || spatialPrompts && spatialIds.includes(s.id))));
  const realSupported = $derived(!minimal && Boolean(folder?.writable) && (!!webViewer || surface.model && !session && /\.(glb|gltf)$/i.test(file)));
  const label = (o: Selected) => o.event !== undefined ? `event ${o.event}${o.name ? ` ${o.name}` : ''}`
    : o.node !== undefined ? `${o.name || 'unnamed'} (node ${o.node})` : o.selector ? `${o.name} at ${o.selector}` : o.name || String(o.id);
  function run(task: () => Promise<void>) {
    foreground++;
    work = work.then(task).catch(e => { error = e.message || String(e); }).finally(() => {
      foreground--;
    });
    return work;
  }
  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('alembic-theme', theme); } catch {}
    if (surface.runtime) void run(() => view(shownBytes, true));  // the embedded app takes its theme from its URL
  }
  async function ensureViewer() {
    if (viewer) return;
    const {createViewer} = await loadViewer();
    const created = await createViewer(host, (center: number[], radius: number, hit: Selected | null) => {
      const shape = tool;
      if (!shape || shape === 'area') return;
      tool = ''; viewer.tool(''); // Disarm before async saves so rapid clicks cannot queue more placements.
      if (shape === 'pick') void run(() => pick(hit, center));
      else void run(() => select({shape, center, radius}));
    }, (value: string) => backend = value, (x: number, y: number) => { void run(() => openMenu('', x, y)); }, () => {
      if (spatialPrompts || ask?.state !== 'brew') void run(dismiss);
    }, {renderOnDemand: true});
    if (disposed) { created.dispose(); throw new Error('Closed'); }
    viewer = created;
  }
  async function view(bytes: Uint8Array, keep = false, resumed: Session | null = null, hydrate = !minimal) {
    releaseInteraction(true);
    stopWebClock();replay.reset();
    for (const request of webRequests.values()) {clearTimeout(request.timer);request.reject(new Error('Web preview changed'))} webRequests.clear();
    webReady = null; webViewer=null; webPlaying = false; webError = ''; appSession = '';
    webDependencyCache.clear();
    if (image) URL.revokeObjectURL(image);
    if (frameFile) URL.revokeObjectURL(frameFile);
    if (session !== resumed) closeRuntime(session);
    image = ''; text = ''; frame = ''; frameFile = ''; animationClips = []; session = null; shownBytes = bytes; lit = ''; error = ''; loaded = new Map();
    const ext = file.split('.').pop()!.toLowerCase();
    surface = surfaceFor(file,canvas?.canonical && canvas.nodes.find((row:any)=>row.id===canvasView));
    kind = surface.kind;
    // Light iframe handshake: the host owns IO; page display needs no runtime binding.
    if (surface.lightIframe) updateInteraction({io_lock:false,configured:true,
      permissions:interactionPermissions(),capabilities:{io_lock:true}});
    if (ext === 'godot')throw new Error('Godot source requires its declared HTML web export');
    if (ext === 'stream') throw new Error('Stream renderer is unavailable; a render-funnel adapter is required');
    let format = '';
    if (ext === 'json') try { format = JSON.parse(decode(bytes)).format; } catch (e) { error = `${file} is not valid JSON: ${(e as Error).message}`; }
    const runtime = runtimes.find(r => r.formats.includes(format));
    if (runtime?.adapter) {
      // A full URL, so the dev server serves the vendored file as it is instead of rewriting the import.
      adapter = adapters[runtime.name] ??= await import(/* @vite-ignore */ asset(`assets/runtimes/${runtime.adapter}`));
      session = resumed ?? await adapter.open(bytes, adapter.worker ? runtimeExecutor(adapter.worker, asset('assets/preview-sw.js')) : undefined);
      if (!session.views.includes(sceneView)) sceneView = session.views[0];
      cycle = Math.min(cycle, session.cycles);
    }
    if (surface.app) {
      previewServer = await discoverPreview(client!.config, asset('assets/preview-origin.json'));
      if (canvas?.canonical && !previewServer && !surface.lightIframe) throw new Error('Spatial render requires the isolated web preview origin');
      if (!previewServer) await preparePreview(asset('assets/preview-sw.js'));
      appRoot = canvas?.canonical && !canvas.nodes.find((row:any)=>row.id===canvasView)?.url && isTypedNode(canvasPath) ? canvasPath + '/' : file.slice(0, file.lastIndexOf('/') + 1);
      if (!file.startsWith(appRoot)) throw new Error('Web render entry is outside its node');
      // The bridge reads this fragment in the browser; even the local entry name stays out of server requests.
      appSession = crypto.randomUUID();
      const expected=appSession;if (!surface.lightIframe) setTimeout(()=>{
        if(appSession===expected&&!webReady)error=webError ||= error || `Render adapter did not become ready: ${file}`;
      },10000);
      frame = `${playURL()}#${new URLSearchParams({host: location.origin, session: appSession, render:canvasView, ...(surface.lightIframe ? {handshake:'light-iframe'} : {}), entry: surface.media ? '__render.html' : file.slice(appRoot.length)})}`;
    } else if (runtime && (appMode || !session)) {
      kind = 'runtime'; surface={...surface,model:false,app:false,runtime:true,grab:false};
      await preparePreview(asset('assets/preview-sw.js'));
      frameFile = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: 'application/json'}));
      frame = asset(`assets/runtimes/${runtime.name}/`) + runtime.open.replace('{theme}', theme).replace('{file}', encodeURIComponent(frameFile));
    } else if (session) {
      kind = 'model'; surface={...surface,model:true,app:false,runtime:false,grab:true};
      await drawScene(keep);
    } else if (surface.model) {
      await ensureViewer();
      await viewer.load(bytes, folder, file, keep);
      animationClips = viewer.animations?.() || [];
      // The actual file owns real shapes; saved highlight documents merely keep their editing handles.
      if (hydrate) try {
        const solids = readSolids(bytes);
        const geometry = (solid: typeof solids[number]) => ({shape: solid.shape as 'sphere' | 'box', center: solid.center,
          ...(solid.shape === 'sphere' ? {radius: solid.radius, radii: solid.radii} : {size: solid.size}),
          objects: [{node: solid.node, name: solid.name}]});
        selections = selections.flatMap(s => {
          if (!isSolid(s)) return [s];
          const solid = solids.find(item => item.solidId === s.solidId);
          if (!solid) return [];
          const {size, radius, radii, ...kept} = s;
          return [{...kept, ...geometry(solid)}];
        });
        for (const solid of solids) if (!selections.some(s => s.solidId === solid.solidId)) {
          selections = [...selections, {id: nextId(), tag: '', mode: 'real', solidId: solid.solidId,
            ...geometry(solid), crop: null}];
        }
      } catch { /* A loader/adapter can supply a fixture without a native glTF document. */ }
      const animation = viewer.animation();
      if (animation) replay.attach({...animation, capture: area => viewer.crop({shape: 'area', area: area ?? [0, 0, 1, 1]})});
      viewer?.volumes(volumes(visible));
      if(canvas?.canonical) {
        const scenarios=readPlaybacks(await folder!.read(canvasPath+'/playbacks.txt'),canvas);
        webReady=await viewer.configure({scenarios,render:canvasView,reset:()=>view(bytes,true),
          interaction:interactionPermissions(),onInteraction:updateInteraction});
        updateInteraction(viewer.interaction);
      }
    } else if (kind === 'image' || kind === 'svg' || kind === 'video' || kind === 'audio') {
      image = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: kind === 'audio' ? `audio/${ext}` : kind === 'video' ? `video/${ext}` : `image/${ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext}`}));
    } else if (kind === 'text') text = decode(bytes.slice(0, 256 * 1024));
  }
  function chooseAnimation(index: number) {
    if (!surface.model || session) return;
    const animation = viewer.selectAnimation?.(index);
    if (animation) replay.attach({...animation, capture: area => viewer.crop({shape: 'area', area: area ?? [0, 0, 1, 1]})});
  }
  // A runtime scene is regenerated from the file itself, so edits to the graph redraw immediately.
  async function drawScene(keep = true) {
    await ensureViewer();
    const event = current?.objects.find(o => o.event !== undefined)?.event ?? null;
    await viewer.load(session!.scene(sceneView, cycle, event), folder, file, keep, adapter!.up);
    paint();
  }
  function scrub(value: number) {
    cycle = value;
    if (scrubbing) return;
    scrubbing = true;
    void run(async () => { scrubbing = false; await drawScene(); });
  }
  // Selections are drawn as their volumes; a pick as a small sphere where it was clicked.
  const volumes = (list: Selection[]) => list.flatMap(s => s.shape === 'area' ? []
    : s.shape !== 'pick' ? [{...s, active: s.id === active}]
    : s.center ? [{...s, shape: 'sphere' as const, active: s.id === active,
      radius: Math.min(s.radius ?? 1, (viewer?.defaultRadius() ?? 1) * 0.1)}] : []);
  // An embedded app gets the active selection only when it changes (apps report what they are told to show; see the adapter).
  function paint() {
    const renderer=spatialViewer();
    if(renderer?.drawShapes)void renderer.drawShapes(interactionState?.io_lock?[]:$state.snapshot(volumes(visible)),shapeStyle,tool);
    else renderer?.volumes(volumes(visible));
    renderer?.previewSolids?.(selections.filter(isSolid));
    if (surface.app && frameEl?.contentWindow) frameEl.contentWindow.postMessage({type: 'alembic.areas', active,
      areas: visible.filter(s => s.shape === 'area').map(s => ({id: s.id, area: [...s.area!]}))}, playOrigin());
    const selected = current?.objects ?? [], ids = JSON.stringify(selected.map(o => o.event ?? o.id));
    if ((surface.runtime || surface.app) && frameEl?.contentWindow && ids !== lit) {
      lit = ids;
      if (surface.runtime) adapter?.highlight?.(frameEl.contentWindow, selected.flatMap(o => o.event ?? []));
      else frameEl.contentWindow.postMessage({type: 'alembic.highlight', ids: selected.flatMap(o => o.id ?? [])}, playOrigin());
    }
  }
  const tabKey = (path: string) => `${client?.config.workspace}:${path}`;
  function rememberTab() {
    if (!folder || !activeTab || !tabs.some(tab => tab.id === activeTab && tab.path === documentPath)) return;
    replay.pause();
    tabStates.set(activeTab, {id: activeTab, folder, path: documentPath, directory: canvasDirectory, bytes: liveBytes.slice(), canvasView,
      selections: $state.snapshot(selections), active, detached: [...detached], parkedAsks: $state.snapshot(parkedAsks), spatialIds: [...spatialIds],
      ...(replay.available ? {moment: replay.snapshot()} : {}), ...(surface.model ? {camera: viewer.replayPose()} : {}),
      sceneView, cycle, appMode, ask: $state.snapshot(ask), sha256: liveSha, runtime: session});
  }
  function clearCanvas() {
    releaseInteraction(true);
    webViewer=null;webReady=null;appSession='';
    canvas = null; canvasPath = ''; canvasView = ''; canvasSha = '';
    replay.reset(); pendingReplay = null;
    detachRuntime(); loaded = new Map(); frame = '';
    if (image) URL.revokeObjectURL(image);
    if (frameFile) URL.revokeObjectURL(frameFile);
    frameFile = ''; image = ''; text = ''; file = ''; kind = ''; surface = {}; liveSha = ''; liveBytes = new Uint8Array();
    selections = []; active = ''; detached = []; menu = null; ask = null; parkedAsks = []; spatialIds = []; tool = ''; shapeMode = 'prompt'; viewer?.tool('');
    error = '';
  }
  async function newTab() {
    rememberTab(); clearCanvas();
    const id = crypto.randomUUID();
    tabs = [...tabs, {id, key: '', path: '', name: `Untitled ${++canvasNumber}`}]; activeTab = id;
    rememberTab();
  }
  async function switchTab(id: string) {
    if (id === activeTab) return;
    const state = tabStates.get(id);
    if (!state) {
      if (tabs.some(tab => tab.id === id && !tab.path)) { rememberTab(); clearCanvas(); activeTab = id; rememberTab(); }
      return;
    }
    rememberTab();
    await useFolder(state.folder);
    activeTab = id;
    if (state.path) await loadFile(state.path, state, state.directory);
  }
  async function closeTab(id: string) {
    const index = tabs.findIndex(tab => tab.id === id); if (index < 0) return;
    const next = tabs[index + 1] ?? tabs[index - 1], wasActive = activeTab === id;
    const cached = tabStates.get(id);
    if (cached?.runtime !== session) closeRuntime(cached?.runtime ?? null);
    tabs = tabs.filter(tab => tab.id !== id); tabStates.delete(id);
    for (const key of viewStates.keys()) if (key.startsWith(id + ':')) viewStates.delete(key);
    if (wasActive) {
      activeTab = ''; clearCanvas();
      if (next) await switchTab(next.id);
    }
  }
  function restoreTabReplay() {
    if (pendingReplay && replay.available) { const moment = pendingReplay; pendingReplay = null; void replay.restore(moment); }
  }
  async function useFolder(next: Folder) {
    releaseInteraction(true);
    manifestStamp = '';
    rememberTab(); activeTab = ''; pendingReplay = null;
    replay.reset();
    detachRuntime(); loaded = new Map(); frame = '';
    if (image) URL.revokeObjectURL(image);
    if (frameFile) URL.revokeObjectURL(frameFile);
    frameFile = ''; image = ''; text = '';
    folder = next; file = ''; kind = ''; surface = {}; selections = []; error = '';
    webViewer=null;webReady=null;appSession='';
    canvas = null; canvasPath = ''; canvasView = ''; canvasSha = '';
    rootOpen = true; active = ''; menu = null; ask = null;
  }
  async function open(path: string, directory?: boolean) {
    if (!folder) throw new Error('Disconnected');
    const key = tabKey(path), blank = tabs.find(tab => tab.id === activeTab && !tab.path);
    const existing = blank ? undefined : tabs.find(tab => tab.id === activeTab && (tab.key === key || tab.originKey === key))
      ?? tabs.find(tab => tab.key === key || tab.originKey === key);
    if (existing) { await switchTab(existing.id); return; }
    rememberTab();
    const tab = blank ?? {id: crypto.randomUUID(), key, path, name: path.split('/').pop()!};
    if (blank) { blank.key = key; blank.path = path; blank.name = path.split('/').pop()!; }
    else tabs = [...tabs, tab];
    activeTab = tab.id;
    await loadFile(path, undefined, directory);
  }
  async function loadFile(path: string, cached?: TabState, directory?: boolean) {
    manifestStamp = ''; manifestReadAt = 0;
    webViewer=null;webReady=null;appSession='';
    canvas = null; canvasPath = ''; canvasSource = ''; canvasDirectory = false; canvasView = ''; canvasDependencies = {};
    if (isTypedNode(path) || /\.canvas$/i.test(path)) {
      const {bytes, source, directory: isDirectory, document: doc, dependencies} = await openNodeDocument(folder!, path, directory);
      canvasSource = source; canvasDirectory = isDirectory;
      canvasDependencies = dependencies as Record<string,{path?:string}> || {};
      canvas = doc; canvasPath = path; canvasSha = await sha256(bytes);
      canvasView = doc.views.includes(cached?.canvasView) ? cached!.canvasView! : doc.defaultView;
      path = doc.nodes.find((node: any) => node.id === canvasView).path;
    }
    await loadAsset(path, cached);
  }
  async function switchCanvasView(id: string) {
    if (!canvas?.views.includes(id) || id === canvasView) return;
    rememberTab(); viewStates.set(`${activeTab}:${canvasView}`, tabStates.get(activeTab)!);
    canvasView = id;
    await loadAsset(canvas.nodes.find((node: any) => node.id === id).path, viewStates.get(`${activeTab}:${id}`));
    rememberTab();
  }
  async function loadAsset(path: string, cached?: TabState) {
    if (!folder) throw new Error('Disconnected');
    replay.reset();
    let warning = '';
    pendingReplay = null; error = ''; file = path; active = ''; selections = !minimal && cached ? structuredClone(cached.selections) : []; menu = null; ask = null;
    detached = cached?.detached ?? []; parkedAsks = structuredClone(cached?.parkedAsks ?? []); spatialIds = [...(cached?.spatialIds ?? [])]; tool = ''; viewer?.tool('');
    sceneView = cached?.sceneView ?? ''; cycle = cached?.cycle ?? 0; appMode = cached?.appMode ?? false;
    const restored = !cached && jobs?.saved(file);
    const saved = minimal ? null : restored ? encode(JSON.stringify(restored))
      : await optionalRead(folder, `.alembic/canvases/${activeTab}.json`)
        ?? (!cached ? await optionalRead(folder, '.alembic/selection.json') : null);
    if (saved) {
      try {
        const data = JSON.parse(decode(saved)), ids = new Set();
        const vector = (value: unknown, length: number) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
        if (!data || !Array.isArray(data.selections) || data.selections.some((s: Selection) => {
          if (!s || typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(s.id) || ids.has(s.id) || typeof s.tag !== 'string' || s.crop !== null && (typeof s.crop !== 'string' || !/^\.alembic\/crops\/[a-zA-Z0-9_/-]+\.png$/.test(s.crop)) ||
            !['sphere', 'box', 'pick', 'area'].includes(s.shape) || !Array.isArray(s.objects) ||
            s.mode !== undefined && !['prompt', 'real'].includes(s.mode) ||
            s.mode === 'real' && (!['sphere', 'box'].includes(s.shape) || typeof s.solidId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(s.solidId)) ||
            s.objects.some(o => !o || typeof o !== 'object' || o.name !== undefined && typeof o.name !== 'string') ||
            s.shape === 'area' && !vector(s.area, 4) ||
            ['sphere', 'box'].includes(s.shape) && !vector(s.center, 3) ||
            s.shape === 'sphere' && (!Number.isFinite(s.radius) || s.radii !== undefined && !vector(s.radii, 3)) ||
            s.shape === 'box' && !vector(s.size, 3) ||
            s.shape === 'pick' && s.center !== undefined && !vector(s.center, 3) ||
            s.temporal && (!Number.isFinite(s.temporal.time) || s.temporal.camera &&
              (!vector(s.temporal.camera.position, 3) || !vector(s.temporal.camera.target, 3)))) return true;
          ids.add(s.id); return false;
        })) throw Error('Invalid saved highlights');
        if (data.file === file && (!cached || folder!.writable && (!data.canvasId || data.canvasId === cached.id))) {
          selections = data.selections;
          if (!cached && data.prompts) {
            const tab = tabs.find(tab => tab.id === activeTab)!; activeTab = tab.id = data.canvasId;
            parkedAsks = structuredClone(data.prompts); active = data.active || ''; ask = parkedAsks.pop() || null;
          }
        }
      } catch {
        const backup = `.alembic/selection-corrupt-${await sha256(saved)}.json`;
        if (folder.writable) await folder.write(backup, saved);
        warning = `Invalid highlights.${folder.writable ? ` ${backup}` : ''}`;
      }
    }
    liveBytes = new Uint8Array(await folder.read(file));
    const stat = await folder.stat(file); signature = `${stat.size}:${stat.lastModified}`;
    liveSha = await sha256(liveBytes); lastFileCheck = Date.now();
    if (cached?.runtime && cached.sha256 !== liveSha) closeRuntime(cached.runtime);
    await view(liveBytes, false, cached?.sha256 === liveSha ? cached.runtime : null, !minimal);
    if (cached && cached.sha256 !== liveSha && surface.model && !session) {
      const before = cached.bytes;
      selections = selections.flatMap(s => s.shape !== 'pick' ? [{...s, objects: viewer.objects(s)}] : before ? follow(s, before, liveBytes) : []);
    }
    if (cached) {
      active = cached.active; ask = cached.ask && selections.some(s => s.id === cached.ask!.id) ? structuredClone(cached.ask) : null;
      if (surface.model && cached.camera) viewer.restoreReplayPose(cached.camera);
      if (cached.sha256 === liveSha) { pendingReplay = cached.moment ?? null; restoreTabReplay(); }
    }
    const count = selections.length;
    prune();
    if (cached || selections.length || selections.length !== count) await persist();
    if (warning && !error) error = warning;
  }
  async function persist(job?: {request: string; details: string}) {
    paint();
    if (minimal || !folder?.writable) return;
    await jobs?.save({version: 1, file, documentPath, canvasId: activeTab, active,
      sha256: liveSha, at: new Date().toISOString(), selections: $state.snapshot(selections),
      prompts: $state.snapshot([...parkedAsks, ...(ask ? [ask] : [])])}, job);
  }
  // Objects inside a volume (runtime objects when a runtime draws the scene), the runtime's own
  // description of up to 5 of them for the agent, and a crop of the view.
  async function capture(selection: Selection) {
    replay.pause();
    if (replay.available) selection.temporal = {...replay.snapshot(), sha256: liveSha,
      ...(surface.model ? {camera: viewer.replayPose()} : {})};
    const app = !webViewer && selection.shape === 'area' && surface.app ? await under(selection.area!) : null;
    if (app) selection.objects = app.objects;
    else if (!webViewer && selection.shape === 'area') selection.objects = surface.model && !session ? viewer.objects(selection) : [];
    else if (!webViewer && selection.shape !== 'pick') selection.objects = session ? session.objects(sceneView, selection) : viewer.objects(selection);
    const events = selection.objects.flatMap(o => o.event ?? []);
    if (session) selection.context = Object.fromEntries(await Promise.all(events.slice(0, 200).map(async e => [e, await session!.describe(e)])));
    delete selection.contextOmitted;
    if (session && events.length > 200) selection.contextOmitted = events.length - 200;
    if(webViewer) {
      const result = await spatialViewer().resolve(selection); selection.objects = result.objects;
      selection.context = result.context; if(result.omitted) selection.contextOmitted = result.omitted;
    }
    if (folder?.writable && (webViewer || app || (selection.center || selection.area) && surface.model || kind === 'svg' || kind === 'image' || replay.available)) {
      const png = webViewer ? await webViewer.crop(selection) : app ? app.png : surface.model ? await viewer.crop(selection.shape === 'pick' ? {...selection, shape: 'sphere'} : selection)
        : kind === 'image' ? await imageCrop(selection.area) : await replay.capture(selection.area);
      selection.crop = png ? `.alembic/crops/${activeTab ? activeTab + '/' : ''}${selection.id}-${crypto.randomUUID()}.png` : null;
      if (png) await folder.write(selection.crop!, png);
    }
  }
  async function imageCrop(area = [0, 0, 1, 1]) {
    const source = new Image(); source.src = image; await source.decode();
    const box = viewport!.getBoundingClientRect(), full = document.createElement('canvas');
    full.width = Math.max(1, box.width); full.height = Math.max(1, box.height);
    const scale = Math.min(box.width / source.width, box.height / source.height);
    full.getContext('2d')!.drawImage(source, (box.width - source.width * scale) / 2, (box.height - source.height * scale) / 2, source.width * scale, source.height * scale);
    const [x, y, w, h] = area, crop = document.createElement('canvas'), factor = Math.min(1, 512 / Math.max(w * box.width, h * box.height));
    crop.width = Math.max(1, Math.round(w * box.width * factor)); crop.height = Math.max(1, Math.round(h * box.height * factor));
    crop.getContext('2d')!.drawImage(full, x * box.width, y * box.height, w * box.width, h * box.height, 0, 0, crop.width, crop.height);
    const blob = await new Promise<Blob | null>(resolve => crop.toBlob(resolve));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  // What an area covers in an embedded app, asked of the play page (it shares the app's origin, so it can look):
  // the elements under it and, where a canvas there can be read back, a crop.
  function under(area: number[]) {
    const id = crypto.randomUUID(), target = frameEl?.contentWindow;
    return new Promise<{objects: Selected[]; png: Uint8Array | null}>(resolve => {
      if (!target) return resolve({objects: [], png: null});
      const finish = (data: {objects?: Selected[]; png?: ArrayBuffer; warning?: string}) => {
        clearTimeout(timer); removeEventListener('message', listen);
        if (data.warning) error = data.warning;
        resolve({objects: data.objects ?? [], png: data.png ? new Uint8Array(data.png) : null});
      };
      const listen = ({data, origin, source}: MessageEvent) => {
        if (origin === playOrigin() && source === target && data?.type === 'alembic.under' && data.id === id) finish(data);
      };
      const timer = setTimeout(() => finish({warning: 'Selection screenshot timed out; metadata retained'}), 12000);
      addEventListener('message', listen);
      target.postMessage({type: 'alembic.area', id, area: [...area]}, playOrigin());
    });
  }
  const nextId = () => `s${Math.max(0, ...selections.map(s => Number(s.id.slice(1)) || 0)) + 1}`;
  async function add(selection: Selection) {
    const previous = selections.find(s => s.id === active);
    if (!spatialPrompts && previous && !isSolid(previous) && !previous.tag?.trim()) await remove(previous.id);
    if (realSupported && shapeMode === 'real' && ['sphere', 'box'].includes(selection.shape)) selection = {...selection, mode: 'real', solidId: crypto.randomUUID()};
    if (isSolid(selection)) await writeSolid(selection);
    await capture(selection);
    selections = [...selections, selection]; active = selection.id;
    if (!isSolid(selection) && !selection.tag?.trim()) temporaryHighlights.add(selection.id);
    if (spatialPrompts) spatialIds = [...spatialIds, selection.id];
    tool = ''; viewer?.tool('');
    await persist();
  }
  async function select(input: Partial<Selection>) {
    if (!spatialViewer() || !input.center || !['sphere', 'box'].includes(input.shape!))
      throw new Error('Open a model');
    const radius = input.radius ?? spatialViewer().defaultRadius();
    await add({id: nextId(), tag: input.tag || '', shape: input.shape!, center: input.center,
      ...(input.shape === 'sphere' ? {radius} : {size: input.size || [radius * 2, radius * 2, radius * 2]}), objects: [], crop: null});
  }
  // Click selection: the object under the pointer (or one picked inside a runtime's own app).
  async function pick(hit: Selected | null, center?: number[]) {
    const probe = {shape: 'sphere' as const, center: center ?? [0, 0, 0], radius: (spatialViewer()?.defaultRadius() ?? 1) * 0.1};
    const objects = !hit ? [] : session && hit.node !== undefined ? session.objects(sceneView, probe) : [hit];
    if (!objects.length) return;
    // Picking something already picked makes that pick active again instead of adding a duplicate.
    const identity = (list: Selected[]) => JSON.stringify(list.map(o => o.event ?? o.node ?? o.id));
    const same = selections.find(s => s.shape === 'pick' && identity(s.objects) === identity(objects));
    if (same) { active = same.id; tool = ''; viewer?.tool(''); paint(); return; }  // no forced resend: apps may echo what they are shown
    await add({id: nextId(), tag: '', shape: 'pick', ...(center ? {center, radius: probe.radius} : {}), objects, crop: null});
  }
  // Selections are chosen by clicking their shape on the canvas, and removed from the editor or with Delete.
  function choose(id: string) {
    replay.pause();
    menu = null;
    if (ask?.id !== id) parkPrompt();
    active = id; detached = detached.filter(item => item !== id); lit = '';
    if (spatialPrompts && id && !spatialIds.includes(id)) spatialIds = [...spatialIds, id];
    const moment = selections.find(s => s.id === id)?.temporal;
    if (moment && replay.available) {
      if (moment.sha256 && moment.sha256 !== liveSha) error = 'Earlier version';
      else void replay.restore(moment); // Selecting a highlight must preserve the current viewpoint.
    }
    if (session && !appMode) void run(() => drawScene()); else paint();
  }
  async function dismiss() {
    const previous = selections.find(s => s.id === active);
    tool = ''; viewer?.tool(''); choose('');
    if (!spatialPrompts && previous && !isSolid(previous) && !previous.tag?.trim()) await remove(previous.id);
  }
  async function remove(id: string) {
    const selection = selections.find(s => s.id === id);
    if (selection && isSolid(selection)) await writeSolid(selection, true);
    temporaryHighlights.delete(id);
    if (menu?.id === id) menu = null;
    if (ask?.id === id) { ask = null; }
    parkedAsks = parkedAsks.filter(node => node.id !== id); spatialIds = spatialIds.filter(value => value !== id);
    selections = selections.filter(s => s.id !== id); if (active === id) active = ''; await persist();
  }
  // A handle drag redraws the volume live; letting go recomputes what it holds and saves it.
  function reshape(next: Selection, done: boolean) {
    replay.pause();
    selections = selections.map(s => s.id === next.id ? next : s);
    paint();
    if (done) return run(async () => {
      if (isSolid(next)) await writeSolid(next);
      await capture(next); selections = [...selections]; await persist();
    });
  }
  // A real shape is part of the file, rather than another translucent prompt volume. Source writes finish
  // before changing the annotation's mode so a failed save keeps the original prompt shape intact.
  async function writeSolid(selection: Selection, remove = false) {
    if(webViewer)throw new Error('This render has no source-editing binding for Solid shapes');
    if (!realSupported) throw new Error('Real solids require a writable GLB or glTF file');
    const latest = new Uint8Array(await folder!.read(file));
    if (await sha256(latest) !== liveSha) throw new Error('The model changed. Wait for it to reload before editing a solid.');
    const bytes = editSolid(latest, file, selection.solidId!, remove ? null : selection);
    await folder!.write(file, bytes);
    liveBytes = bytes; liveSha = await sha256(bytes);
    const stat = await folder!.stat(file); signature = `${stat.size}:${stat.lastModified}`;
    await view(bytes, true, null, false);
  }
  function setShapeMode(mode: 'prompt' | 'real') {
    if (mode === 'real' && !realSupported) return;
    shapeMode = mode; menu = null; parkPrompt(); tool = ''; viewer?.tool('');
  }
  async function setSelectionMode(id: string, mode: 'prompt' | 'real') {
    const prior = selections.find(s => s.id === id);
    if (!prior || !['sphere', 'box'].includes(prior.shape)) return;
    const next: Selection = {...$state.snapshot(prior), mode, solidId: prior.solidId || crypto.randomUUID()};
    await writeSolid(next, mode === 'prompt');
    if (mode === 'prompt') delete next.solidId;
    delete next.temporal;
    await capture(next);
    selections = selections.map(s => s.id === id ? next : s);
    menu = null; parkPrompt(); active = id;
    await persist();
  }
  async function poll() {
    const from = folder, path = file, scene = canvasPath, viewId = canvasView, beforeSha = liveSha;
    if (!from?.writable || foreground) return;
    const current = () => !disposed && folder === from && file === path && canvasPath === scene && canvasView === viewId && liveSha === beforeSha;
    try {
      await checkRender();
      if (!current()) return;
      if (scene) {
        const source = canvasSource || scene, stat = await from.stat(source);
        const stamp = `${stat.size}:${stat.lastModified}`;
        let bytes: Uint8Array | null = null, hash = canvasSha;
        if (stamp !== manifestStamp || Date.now() - manifestReadAt >= 10000) {
          bytes = await from.read(source); hash = await sha256(bytes);
          manifestStamp = stamp; manifestReadAt = Date.now();
        }
        if (!current()) return;
        if (bytes && hash !== canvasSha) {
          let nextSource = source, nextHash = hash, nextDependencies = canvasDependencies;
          let doc;
          if (isTypedNode(scene) && canvasDirectory && !source.endsWith('/view.txt')) {
            const reopened = await openNodeDocument(from, scene, true);
            doc = reopened.document; nextSource = reopened.source; nextHash = await sha256(reopened.bytes); nextDependencies = reopened.dependencies as Record<string,{path?:string}> || {};
          } else doc = isTypedNode(scene) ? source.endsWith('/view.txt') ? readView(bytes, scene) : readNode(bytes, scene, canvasDirectory) : readCanvas(bytes);
          await run(async () => {
            if (!current()) return;
            canvas = doc; canvasSha = nextHash; canvasSource = nextSource; canvasDependencies = nextDependencies;
            if (!doc.views.includes(canvasView)) canvasView = doc.defaultView;
            const selectedView = doc.nodes.find((n: any) => n.id === canvasView);
            const nextPath = selectedView.path;
            if (path !== nextPath) await loadAsset(nextPath);
          });
          if (!current()) return;
        }
      }
      if (!path || !current()) return;
      let stat;
      try { stat = await from.stat(path); }
      catch (e) {
        if (current() && !(e as any).retryable) error = statError = `${path}: ${(e as Error).message}`;
        return;
      }
      if (!current()) return;
      if (statError && error === statError) error = '';
      statError = '';
      const next = `${stat.size}:${stat.lastModified}`;
      if (next === signature && surface.app) {
        if (await stale(from)) await run(async () => { if (current()) await view(liveBytes, true); });
        return;
      }
      // Metadata detects normal edits immediately. Small files also compare bytes every poll;
      // only large assets use a grace period, avoiding routine multi-megabyte freshness reads.
      if (next === signature && stat.size > 256 * 1024 && Date.now() - stat.lastModified > 3000 && Date.now() - lastFileCheck < 10000) return;
      const bytes = await from.read(path), sha = await sha256(bytes);
      if (!current()) return;
      lastFileCheck = Date.now(); signature = next;
      if (sha === beforeSha) return;
      await run(async () => {
        if (!current()) return;
        liveSha = sha;
        const before = liveBytes, had = selections.length;
        liveBytes = new Uint8Array(bytes);
        await view(bytes, true);
        if (surface.model && !session) selections = selections.flatMap(s => s.shape !== 'pick' ? [{...s, objects: viewer.objects(s)}] : follow(s, before, bytes));
        prune();
        if (had || selections.length) await persist();
      });
    } catch (error) {
      if (current() && !(error as any).retryable) throw error;
    }
  }
  async function checkRender() {
    const from = folder!;
    if (renderFolder !== from) {
      renderFolder = from; seenRender = ''; latestRender = null; openedRenders = new Set();
    }
    let stat;
    try { stat = await from.stat('.alembic/preview.json'); } catch { return; }
    if (stat.size > 16384) return;
    const notice = renderNotice(await from.read('.alembic/preview.json'));
    if (!notice || notice.id === seenRender) return;
    try { await from.stat(notice.path); } catch { return; } // Retry a handoff that arrived before its file.
    if (folder !== from) return;
    seenRender = notice.id; latestRender = notice;
    if (notice.path === file || notice.path === documentPath) lastFileCheck = 0;
    if (spatialPrompts && notice.path === file && surface.model && !session) {
      const path = file;
      await run(async () => {
        if (folder !== from || file !== path) return;
        const bytes = new Uint8Array(await from.read(path));
        liveBytes = bytes; liveSha = await sha256(bytes);
        await view(bytes, true); paint();
      });
    }
    if (autoOpenRenderTabs) await run(() => openRenderPreview(true));
  }
  async function openRenderPreview(fresh = false) {
    if (!latestRender) return;
    const notice = {...latestRender};
    if (fresh && !openedRenders.has(notice.id)) {
      await newTab();
      await open(notice.path);
      const tab = tabs.find(tab => tab.id === activeTab)!;
      tab.originKey = tabKey(notice.path); tab.key = `${tab.originKey}:render:${notice.id}`;
      openedRenders.add(notice.id);
    } else {
      await open(notice.path);
      openedRenders.add(notice.id);
    }
  }
  async function stale(from = folder!) {
    const now = await Promise.all([...loaded].map(([path, seen]) =>
      from.stat(path).then(s => `${s.size}:${s.lastModified}` !== seen, () => true)));
    return now.some(Boolean);
  }
  // A picked node follows its [name, occurrence] key into the edited scene, or is dropped with it.
  function follow(selection: Selection, before: Uint8Array, after: Uint8Array): Selection[] {
    let old: string[], now: string[];
    try { old = keys(container(before).json); now = keys(container(after).json); } catch { return [selection]; }
    const objects = selection.objects.flatMap(o => o.node === undefined ? [o] : now.includes(old[o.node]) ? [{...o, node: now.indexOf(old[o.node])}] : []);
    return objects.length ? [{...selection, objects}] : [];
  }
  // Runtime selections keep only events the current file still has, with their context.
  function prune() {
    if (session) selections = selections.flatMap(s => {
      const objects = s.objects.filter(o => o.event === undefined || session!.has(o.event));
      const context = s.context && Object.fromEntries(Object.entries(s.context).filter(([event]) => session!.has(Number(event))));
      return objects.length ? [{...s, objects, ...(context && {context})}] : [];
    });
    if (!selections.some(s => s.id === active)) active = '';
  }
  // A connected session is talked to in its own terminal; otherwise the chat runs its own variant.
  function promptContext(selection: Selection): PromptContext {
    return {file, sha256: liveSha, canvasId: activeTab, selection: structuredClone($state.snapshot(selection)),
      ...(canvas ? {canvas: {path: canvasPath, view: canvasView, title: canvas.title, scene: $state.snapshot(canvas.scene), nodes: $state.snapshot(canvas.nodes)}} : {}),
};
  }
  async function preparePrompt(prompt: string, contexts: PromptContext[], request: string) {
    if (minimal) throw new Error('Editing is available through SSH in this layout');
    if (!client) throw new Error('Disconnected');
    const descriptions: string[] = [], references: string[] = [];
    for (const context of contexts) {
      const selection = context.selection;
      const path = `.alembic/selections/${context.canvasId}/${selection.id}-${request}.json`;
      await client.write(path, encode(JSON.stringify({version: 1, file: context.file, at: 'live', sha256: context.sha256,
        prompt, selection, ...(context.canvas ? {canvas: context.canvas} : {})}) + '\n'));
      descriptions.push(path);
      if (selection.crop) references.push(selection.crop);
    }
    const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ');
    const reference = references.length && !spatialPrompts ? `Look at ${references.map(clean).join(', ')}: ` : '';
    const selected = contexts[0], sourceCanvas = selected?.canvas || canvas, sourceFile = selected?.file || file;
    const selectedView = sourceCanvas?.nodes.find((node: any) => node.id === (selected?.canvas?.view || canvasView));
    const source = selected?.source || sourceFile, targets = selected?.editTargets;
    const target = sourceCanvas && selectedView ? `Node ${sourceCanvas.path || canvasPath}; view ${selectedView.label} (${sourceFile}); source ${source}${targets?.length ? `; edit targets ${targets.join(', ')}` : ''}. ` : '';
    const line = target + reference + clean(prompt) + (descriptions.length ? ` (details: ${descriptions.map(clean).join(', ')})` : '');
    await client.annotate(contexts.length ? 'selection' : 'prompt', line);
    return line;
  }
  function completePrompt(tab: string, request: string, state: 'done' | 'fail', note: string, result = '') {
    if (disposed) return;
    const update = (node: PromptAsk) => node.request === request
      ? {...node, state, note, result, hidden: state === 'done' || node.hidden} : node;
    if (activeTab === tab) {
      if (ask) ask = update(ask);
      parkedAsks = parkedAsks.map(update);
    } else {
      const cached = tabStates.get(tab);
      if (cached?.ask) cached.ask = update(cached.ask);
      if (cached?.parkedAsks) cached.parkedAsks = cached.parkedAsks.map(update);
    }
  }
  function parkPrompt() {
    if (ask) parkedAsks = [...parkedAsks.filter(node => node.id !== ask!.id), ask];
    ask = null;
  }
  async function closePrompt(id: string) {
    const pending = [ask, ...parkedAsks].find(node => node?.id === id && node.state === 'brew');
    if (ask?.id === id) ask = null;
    parkedAsks = [...parkedAsks.filter(node => node.id !== id), ...(pending ? [{...pending, hidden: true}] : [])];
    if (temporaryHighlights.has(id) && selections.some(s => s.id === id && !isSolid(s))) await remove(id);
    else await persist();
  }
  function movePrompt(id: string, x: number, y: number) {
    if (ask?.id === id) ask = {...ask, x, y, dragged: true};
    else parkedAsks = parkedAsks.map(node => node.id === id ? {...node, x, y, dragged: true} : node);
  }
  // The chat's own conversation survives reloads, so it reconnects instead of starting fresh.
  const chatKey = () => 'alembic-chat:' + client?.config.workspace;
  function saveChat() { try { localStorage.setItem(chatKey(), JSON.stringify({variant, conversation, chatLog, dropped})); } catch {} }
  async function openMenu(id: string, clientX: number, clientY: number) {
    if (minimal) return;
    if (id && !selections.some(s => s.id === id)) return;
    if (!id && !spatialViewer()) return;
    const box = viewport!.getBoundingClientRect();
    if (id) choose(id); parkPrompt();
    tool = ''; viewer?.tool('');
    const found=id?null:spatialViewer()?.locate?.(clientX,clientY),at=found?.then?await found:found;
    menu = {id, x: Math.max(4, Math.min(box.width - 144, clientX - box.left)),
      y: Math.max(4, Math.min(box.height - 180, clientY - box.top)), ...(at ? {point: at.point, hit: at.object} : {})};
  }
  async function promptMenu() {
    const at = menu; if (!at) return;
    let id = at.id;
    if (!id) {
      if (!at.point) return;
      id = nextId();
      await add({id, tag: '', shape: 'pick', center: at.point, radius: spatialViewer().defaultRadius() * .1, objects: at.hit ? [at.hit] : [], crop: null});
    }
    openAsk(id, at.x, at.y);
  }
  // The node sits to the right of the point it is wired to, or to its left where the viewport has no room.
  function openAsk(id: string, ax: number, ay: number) {
    replay.pause();
    const previous = ask?.id === id ? ask : parkedAsks.find(node => node.id === id);
    if (ask?.id !== id) parkPrompt();
    parkedAsks = parkedAsks.filter(node => node.id !== id);
    const box = viewport!.getBoundingClientRect(), x = ax + 56 + 272 <= box.width ? ax + 56 : ax - 56 - 264;
    menu = null; active = id;
    ask = previous && !previous.hidden ? {...previous, hidden: false} : {id, ax, ay,
      x: Math.max(8, Math.min(box.width - 272, x)), y: Math.max(8, Math.min(box.height - 150, ay - 40)),
      state: 'edit', note: '', text: '', context: promptContext(selections.find(s => s.id === id)!)};
    const center = selections.find(s => s.id === id)?.center, camera = spatialViewer(), at = center && camera?.project(center);
    if (spatialPrompts && !ask.point && center && at && spatialViewer()) {
      const frame = camera.dragFrame(center);
      ask.point = center.map((value, k) => value + frame.scale * ((ask!.x - at[0]) * frame.right[k] - (ask!.y - at[1]) * frame.up[k]));
      ask.unit = frame.scale;
    }
  }
  async function placeNative(shape: string, at: any) {
    if(!spatialViewer()) return;
    if(shape === 'pick' && at.object) await pick(at.object,at.point);
    else if(shape === 'pick') await add({id:nextId(),tag:'',shape:'pick',center:at.point,radius:at.radius*.1,objects:[],crop:null});
    else await select({shape:shape as Selection['shape'],center:at.point,radius:at.radius});
  }
  // One prompt per node: it becomes the selection's tag (kept in selection.json), then goes to the agent.
  async function brew(text: string, targetId = ask!.id) {
    if (canvasPromptDisabled) throw new Error(canvasPromptDisabled);
    const node = ask?.id === targetId ? ask : parkedAsks.find(value => value.id === targetId);
    if (!node) return;
    const id = node.id;
    const request = crypto.randomUUID(), tab = activeTab;
    const context = node.context || promptContext(selections.find(s => s.id === id)!);
    const detailsRequest = crypto.randomUUID(), send = terminalPrompt;
    const details = `.alembic/selections/${context.canvasId}/${context.selection.id}-${detailsRequest}.json`;
    if (ask?.id === id) ask = {...node, state: 'brew', note: 'Brewing', result: '', request};
    else parkedAsks = parkedAsks.map(value => value.id === id ? {...value, state: 'brew', note: 'Brewing', result: '', request} : value);
    try {
      if (!send) throw new Error('No active session in terminal');
      temporaryHighlights.delete(id);
      selections = selections.map(s => s.id === id ? {...s, tag: text} : s);
      await persist({request, details});
      const prompt = await preparePrompt(text, [context], detailsRequest);
      nativeDraft=prompt;chatReveal++;
      await send(prompt);
      if(nativeDraft===prompt)nativeDraft='';
    } catch (e) { completePrompt(tab, request, 'fail', (e as Error).message);
      await jobs?.fail(tab, request, (e as Error).message).catch(() => {}); }
  }
  async function say() { throw new Error('Use the sandbox terminal'); }
  async function selectAgent(row: AgentSession) {
    agentRows = mergeSession(agentRows, row); selectedAgent = sessionKey(row); dropped = false; saveChat();
  }
  function forget() { selectedAgent = ''; }
  async function control(action: 'cancel' | 'reset' | 'disconnect') {
    if (action === 'reset') { chatEpoch++; chatLog = []; conversation = {variant: '', id: ''}; saveChat(); }
    else if (action === 'disconnect') { forget(); dropped = true; saveChat(); }
    else { /* Native turn cancellation is owned by the PTY. */ }
    return true;
  }
  // Only agents that called in count as connected; sessions leave the list when their process is gone.
  const connectedRows = (rows: AgentSession[]) => rows.filter(row => !row.external || row.last_command);
  const autoConnect = (row: AgentSession) => variant.split('/').pop() !== 'codex' && !selectedAgent && !dropped && !['shell', 'ssh'].includes(row.agent);
  function sessionFailed(cause: unknown) {
    const previous = sessionError;
    sessionError = cause instanceof Error ? cause.message : String(cause);
    if (!error || error === previous) error = sessionError;
  }
  function relist(node: NodeClient) {
    if (listing) return listing;
    listing = (async () => {
      try {
        const rows = connectedRows(await node.sessions());
        if (disposed) return;
        agentRows = rows;
        if (!agents.length && Date.now() - lastAgentDiscovery >= 30000) {
          lastAgentDiscovery = Date.now(); await availableAgents(node);
        }
        if (disposed) return;
        if (error === sessionError) error = '';
        sessionError = '';
        if (selectedAgent && !agentRows.some(row => sessionKey(row) === selectedAgent)) forget();
        const recent = agentRows.filter(row => row.last_command && autoConnect(row)).sort((a, b) => b.last_command! - a.last_command!)[0];
        if (recent) selectedAgent = sessionKey(recent);
      } catch (cause) {
        if (!disposed) sessionFailed(cause);
        throw cause;
      }
    })().finally(() => { listing = null; });
    return listing;
  }
  function agentEvent(event: any) {
    if (['commit', 'run.end', 'turn.end', 'node.restored', 'node.descriptor-migrated'].includes(event.kind)) invalidateSources();
    const row = commandSession(event, client?.config.vm);
    if (row) {
      agentRows = mergeSession(agentRows, row);
      if (autoConnect(row)) selectedAgent = sessionKey(row);
    } else if (event.kind === 'call.end') {
      agentRows = agentRows.filter(row => row.id !== event.call);
      if (selectedAgent === event.call) forget();
    }
  }
  function invalidateSources() {
    folder?.invalidate?.();
    lastFileCheck = 0; manifestReadAt = 0; manifestStamp = '';
  }
  async function watchAgents(node: NodeClient, cursor: string) {
    while (!disposed) {
      try { await node.events((event: any) => { cursor = String(event.id); if (!disposed) agentEvent(event); }, cursor); }
      catch (e) { if (!disposed) sessionFailed(e); }
      if (!disposed) await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  onMount(() => {
    try { const saved = localStorage.getItem('alembic-theme'); if (saved === 'light' || saved === 'dark') theme = saved; } catch {}
    try { const saved = JSON.parse(localStorage.getItem('alembic-settings') || '{}'); if (['new-session', 'chat'].includes(saved.canvasPromptMode)) canvasPromptMode = saved.canvasPromptMode; } catch {}
    try { autoOpenRenderTabs = JSON.parse(localStorage.getItem('alembic-settings') || '{}').autoOpenRenderTabs === true; } catch {}
    ready = (async () => {
      client = new NodeClient(tabConnection());
      const projects = await client.workspaces(), project = projects.find((row: any) => row.id === client!.config.workspace);
      if (!project) throw new Error('Project unavailable');
      await useFolder(nodeFolder(client, projectName(project, projects)));
      if (!minimal) jobs = await promptJobs(folder!, client, completePrompt, run, cause => error = cause.message);
      const node = client;
      // Refresh a saved VM identity even when the initial layout makes no VM requests.
      node.vmUnverified = true; let vmVerified = true;
      try { await node.reconnectVm(node.config.vm); }
      catch (cause) { vmVerified = false; if (!disposed) sessionFailed(cause); }
      if (!minimal) {
        try { if (vmVerified) { lastAgentDiscovery = Date.now(); await availableAgents(node); } }
        catch (cause) { if (!disposed) { agentIssue = `Agent discovery failed: ${(cause as Error).message}`; sessionFailed(cause); } }
        const cursor = String(Date.now() * 1000);
        try { ({variant, conversation, chatLog, dropped} = {variant, conversation, chatLog, dropped, ...JSON.parse(localStorage.getItem(chatKey()) || '{}')}); } catch {}
        if (!agents.includes(variant)) variant = node.config.agents?.find(name => agents.includes(name)) || agents[0] || '';
        // A temporarily stopped VM must not prevent the file UI and periodic reconnect checks starting.
        if (vmVerified) try { await relist(node); } catch { /* The session poll below retries after bounded recovery expires. */ }
        void watchAgents(node, cursor);
      }
      const declared = await fetch(asset('assets/runtimes/manifest.json'));
      runtimes = declared.ok ? await declared.json() : [];
      const requested = new URLSearchParams(location.search).get('file') || jobs?.latest();
      if (requested) await open(requested);
      if (!disposed) timer = setInterval(() => {
        if (polling || typeof document !== 'undefined' && document.hidden) return;
        polling = true;
        return poll().catch(e => { if (!disposed) error = e.message || String(e); }).finally(() => polling = false);
      }, 1000);
      if (!disposed && !minimal) sessionTimer = setInterval(() => { void relist(node).catch(() => {}); }, 5000);
    })();
    ready.catch(e => { error = e.message; if(client?.readiness)client.readiness.error=e.message; });
    // The app's file requests and picks; it may read anything under its own folder except dotfiles.
    const messages = ({data, origin, source}: MessageEvent) => {
      const target = frameEl?.contentWindow;
      if (origin !== playOrigin() || !target || source !== target || !folder || !surface.app) return;
      if (typeof data?.type === 'string' && data.type.startsWith('alembic.web.')) {
        if (!canvas || data.session !== appSession) return;
        if(data.type==='alembic.web.interaction.key' && ['F3','Escape'].includes(data.key)){
          if(data.key==='Escape'){document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return}
          void toggleInteraction('io_lock').catch(cause=>error=cause.message);return;
        }
        if(data.type==='alembic.web.camera'){try{webViewer?.update(data.camera)}catch(cause){error=(cause as Error).message}return}
        if(data.type==='alembic.web.failure'){error=webError=data.error;return}
        if(data.type==='alembic.web.place'){void run(()=>placeNative(data.shape,{...data,radius:webViewer?.defaultRadius()}));return}
        if(data.type==='alembic.web.menu'){const box=viewport!.getBoundingClientRect();void run(()=>openMenu('',box.left+data.point[0],box.top+data.point[1]));return}
        const list = (value:any) => Array.isArray(value) && value.length <= 128 && value.every((part:any)=>typeof part==='string' && /^[A-Za-z][\w-]{0,63}$/.test(part)) && new Set(value).size===value.length;
        if (data.type === 'alembic.web.ready') {
          if (surface.lightIframe) {
            // Optional playback metadata; never gates page visibility or host IO.
            if (list(data.renders) && data.renders.includes(canvasView) && list(data.scenarios))
              webReady={renders:data.renders,scenarios:data.scenarios,exports:[],controls:[],seek:list(data.seek)?data.seek:[]};
            return;
          }
          if(/\.i3d$/i.test(canvasPath)) {
            if(!data.renderer?.camera || data.renderer.gpu?.software!==false){error=webError='Renderable has no hardware spatial renderer binding';return}
            webViewer ||= webSurface(webCall,body=>frameEl?.contentWindow?.postMessage({...body,session:appSession},playOrigin()),()=>viewport!.getBoundingClientRect(),file,data.renderer.camera);
          }
          const required=/\.i3d$/i.test(canvasPath)
            ? ['orbit','pan','zoom','play','reset','escape'] : ['play','reset','escape'];
          if (!list(data.renders) || !list(data.scenarios) || !list(data.exports) || !list(data.controls) ||
              data.seek !== undefined && !list(data.seek) || !data.renders.includes(canvasView) || required.some(control=>!data.controls.includes(control))) {
            webReady=null;webError='Web render bindings or inspect controls are unavailable';error=webError;return;
          }
          const declared=(canvas.exports||[]).filter((row:any)=>row.scope==='*' || row.scope===canvasView);
          const missing=declared.find((row:any)=>!data.exports.includes(row.id));
          if (missing) {webReady=null;webError=`Missing runtime export ${missing.id}`;error=webError;return}
          if(!data.interaction||data.interaction.io_lock!==false){
            webReady=null;error=webError='Renderable must start in inspection and implement the interaction contract';
            return
          }
          webReady={renders:data.renders,scenarios:data.scenarios,exports:data.exports,controls:data.controls,seek:data.seek||[]};if(error===webError)error='';webError='';
          if(data.interaction){
            const epoch=interactionEpoch;
            void webCall('alembic.web.configure',{interaction:{...interactionPermissions()},threeD:/\.i3d$/i.test(canvasPath)}).then(state=>{if(epoch===interactionEpoch)updateInteraction(state)}).catch(cause=>{if(epoch===interactionEpoch)error=cause.message});
          }
          return;
        }
        if(data.type==='alembic.web.interaction.result'){
          if(surface.lightIframe)return; // Optional page bindings cannot replace host-owned IO.
          if(data.id===null){try{updateInteraction(data.state)}catch(cause){error=(cause as Error).message}return}
          const pending=webRequests.get(data.id);if(!pending)return;clearTimeout(pending.timer);webRequests.delete(data.id);
          if(data.ok===true)pending.resolve(data.state);else pending.reject(Object.assign(new Error(data.error||'Interaction failed'),{interactionState:data.state}));return;
        }
        if (data.type === 'alembic.web.inspect') {webInspectRevision++;webPlaying=false;stopWebClock();return}
        if (data.type === 'alembic.web.result' && typeof data.id==='string') {
          const pending=webRequests.get(data.id);if(!pending)return;
          clearTimeout(pending.timer);webRequests.delete(data.id);
          if (data.ok===true) pending.resolve(data.result);else pending.reject(new Error(typeof data.error==='string' ? data.error.slice(0,200) : 'Web playback failed'));
          return;
        }
      }
      if (surface.lightIframe && data?.session === appSession && data.type === 'alembic.iframe.key') {
        if(data.key==='Escape')document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        else if(data.key==='F3')void toggleInteraction('io_lock').catch(cause=>error=cause.message);
        return;
      }
      if (data?.type === 'alembic.read') {
        if(appSession && new URLSearchParams(new URL(frameEl!.src).hash.slice(1)).get('session')!==appSession)return;
        const reply = (body: object, transfer: Transferable[] = []) => target.postMessage({type: 'alembic.file', id: data.id, ...body}, playOrigin(), transfer);
        if (surface.media && data.path==='__render.html') {
          void folder.read(canvasPath+'/playbacks.txt').then(index=>{
            const render={...canvas.nodes.find((row:any)=>row.id===canvasView),entry:file.slice(appRoot.length)};
            const bytes=mediaEntry(canvasPath,render,readPlaybacks(index,canvas),canvas.exports,
              getComputedStyle(viewport!).getPropertyValue('--canvas').trim(),shownBytes);
            reply({bytes:bytes.buffer},[bytes.buffer]);
          }).catch(cause=>reply({error:cause.message}));
          return;
        }
        if (typeof data.path !== 'string' || data.path.includes('\\') || data.path.split('/').some((part: string) => !part || part.startsWith('.'))) reply({error: 'Invalid path'});
        else {
          const from = folder;  // stat first: a change between the two still reloads
          const path=canvas?.canonical && !canvas.nodes.find((row:any)=>row.id===canvasView)?.url ? resolveWebPath(canvasPath,data.path,canvasDependencies,(base:string)=>{
            if(!webDependencyCache.has(base))webDependencyCache.set(base,(async()=>{
              const descriptor=base+'/.node.txt',stat=await from.stat(descriptor),bytes=await from.read(descriptor);
              loaded.set(descriptor,`${stat.size}:${stat.lastModified}`);
              readNode(bytes,base,true);
              const exportsPath=base+'/exports.txt',exportsStat=await from.stat(exportsPath);
              loaded.set(exportsPath,`${exportsStat.size}:${exportsStat.lastModified}`);
              readExports(await from.read(exportsPath),base,{child:true});
              return JSON.parse(new TextDecoder().decode(bytes)).dependencies as Record<string,{path?:string}>;
            })().catch(error=>{webDependencyCache.delete(base);throw error}));
            return webDependencyCache.get(base)!;
          }) : Promise.resolve(appRoot+data.path);
          path.then(path=>from.stat(path).then(s => {
            loaded.set(path, `${s.size}:${s.lastModified}`);
            return s.size > 16 * 1024 * 1024 ? readPreviewFile(client!, path, s.size) : from.read(path);
          }))
            .then(bytes => {
              if(!surface.lightIframe && isTypedNode(canvasPath) && data.path.endsWith('.html')) {
                bytes=checkedHTML(bytes,canvasPath);
              }
              reply({bytes: bytes.buffer}, [bytes.buffer]);
            }, e => {error=e.message;reply({error:e.message})});
        }
      } else if (data?.type === 'alembic.pick') void run(() => pick({id: String(data.id), name: String(data.name ?? '')}));
      else if (data?.type === 'alembic.ready') {
        if (surface.lightIframe) releaseInteraction();
        if (!surface.lightIframe) target.postMessage({type:'alembic.web.connect',session:appSession},playOrigin());
        lit = ''; paint();
      }
      else if (data?.type === 'alembic.area-menu' && selections.some(s => s.id === data.id && s.shape === 'area')) {
        const box = viewport!.getBoundingClientRect();
        openMenu(data.id, box.left + data.x * box.width, box.top + data.y * box.height);
      } else if (data?.type === 'alembic.dismiss') menu = null;
    };
    const refreshOnFocus = () => { if (!document.hidden) invalidateSources(); };
    const releaseOnBlur=()=>{if(globalThis.document && (document.hidden||!document.hasFocus()))releaseInteraction()};
    addEventListener('focus', refreshOnFocus);
    const rememberInteraction=(event:PointerEvent)=>{
      const key=(event.target as Element)?.closest?.('button')?.getAttribute('aria-label');
      interactionGesture=key==='io_lock'?{key,state:$state.snapshot(interactionState),at:performance.now()}:null
    };
    addEventListener('pointerdown',rememberInteraction,true);
    addEventListener('blur',releaseOnBlur);globalThis.document?.addEventListener('visibilitychange',releaseOnBlur);
    addEventListener('message', messages);
    (window as any).__alembic = {
      ready: () => ready, connectionReadiness: () => client ? {workspace:client.config.workspace,vm:client.config.vm,...client.readiness} : {workspaceListed:false,vmVerified:false,rootTreeListed:false,error:''},
      open: (path: string) => run(() => open(path)),
      select: async (input: Partial<Selection>) => { await run(() => select(input)); return documentSelection(); },
      pick: async (hit: Selected, center?: number[]) => { await run(() => pick(hit, center)); return documentSelection(); },
      selection: documentSelection,
      scene: (name: string, at = 0) => run(async () => { sceneView = name; cycle = at; await drawScene(); }),
      app: (on: boolean) => run(async () => { appMode = on; await view(liveBytes, true); }),
      state: () => ({file, backend: backend, kind, view: sceneView, cycle, cycles: session?.cycles ?? 0,
        ...(spatialPrompts ? {active, highlights: selections.map(s => ({id: s.id, center: s.center && [...s.center], shape: s.shape})),
          prompts: promptNodes.map(node => ({id: node.id, state: node.state, note: node.note}))} : {})}),
      pose: () => spatialViewer()?.pose(), project: (point: number[]) => spatialViewer()?.project(point)
    };
    return () => {
      jobs?.close();
      releaseInteraction(true); stopWebClock(); disposed = true; clearInterval(sessionTimer);
      removeEventListener('focus', refreshOnFocus); removeEventListener('pointerdown',rememberInteraction,true);
      removeEventListener('blur',releaseOnBlur);
      globalThis.document?.removeEventListener('visibilitychange',releaseOnBlur);
      removeEventListener('message', messages); delete (window as any).__alembic;
      replay.reset(); clearInterval(timer); client?.close();
      closeRuntime(session); for (const state of tabStates.values()) closeRuntime(state.runtime);
      viewer?.dispose(); if (image) URL.revokeObjectURL(image); if (frameFile) URL.revokeObjectURL(frameFile);
    };
  });
  function documentSelection() {
    return {version: 1, file, sha256: liveSha,
      selections: structuredClone($state.snapshot(selections))};
  }
  async function markReplay(edge: 'start' | 'end' | 'clear') {
    const selection = selections.find(s => s.id === active);
    if (selection?.temporal?.sha256 && selection.temporal.sha256 !== liveSha) {
      error = 'Earlier version'; return;
    }
    if (edge === 'clear') replay.clearRange(); else replay.mark(edge);
    if (selection) {
      selection.temporal = {...selection.temporal, ...replay.snapshot(), time: selection.temporal?.time ?? replay.time, sha256: liveSha};
      if (edge === 'clear' || replay.start === null || replay.end === null) { delete selection.temporal.start; delete selection.temporal.end; }
      await persist();
    }
  }
  return {
    get minimal() { return minimal; },
    get folder() { return folder; }, set folder(value) { folder = value; },
    get tabs() { return tabs; }, get activeTab() { return activeTab; }, switchTab, closeTab, newTab, restoreTabReplay,
    get rootOpen() { return rootOpen; }, set rootOpen(value) { rootOpen = value; },
    get session() { void runtimeRevision; return session; }, set session(value) { session = value; },
    get terminal(): RuntimeCommands | undefined {
      const target = session;
      if (!target?.terminal) return;
      return {...target.terminal, invoke: async (line, signal) => {
        const result = await target.terminal!.invoke(line, signal);
        if (session === target) {
          cycle = Math.min(cycle, target.cycles);
          // Refresh metadata and the scene after a runtime command changes its result.
          runtimeRevision++; await drawScene();
        }
        return result;
      }};
    },
    get sceneView() { return sceneView; }, set sceneView(value) { sceneView = value; },
    get cycle() { return cycle; }, set cycle(value) { cycle = value; },
    get appMode() { return appMode; }, set appMode(value) { appMode = value; },
    get frame() { return frame; }, set frame(value) { frame = value; },
    get frameEl() { return frameEl; }, set frameEl(value) { frameEl = value; },
    get canvas() { return canvas; }, get canvasPath() { return canvasPath; }, get canvasView() { return canvasView; },
    get webReady() { return webReady; }, get webPlaying() { return webPlaying; }, get webError() { return webError; }, playWebScenario:(name:string)=>run(()=>playWebScenario(name)), resetWebScenario:()=>run(resetWebScenario),
    get documentPath() { return documentPath; }, switchCanvasView,
    get file() { return file; }, set file(value) { file = value; },
    get backend() { return backend; }, set backend(value) { backend = value; },
    get surface() { return surface; },
    get kind() { return kind; }, set kind(value) { kind = value; },
    get text() { return text; }, set text(value) { text = value; },
    get image() { return image; }, set image(value) { image = value; },
    get selections() { return selections; }, set selections(value) { selections = value; },
    get theme() { return theme; }, set theme(value) { theme = value; },
    get error() { return error; }, set error(value) { error = value; },
    get tool() { return tool; }, set tool(value) { tool = value; paint(); },
    get active() { return active; }, set active(value) { active = value; },
    get shapeMode() { return realSupported ? shapeMode : 'prompt'; }, get realSupported() { return realSupported; },
    get viewer() { return viewer; }, set viewer(value) { viewer = value; },
    get spatialViewer() { return spatialViewer(); }, get spatialSupported() { return !!spatialViewer(); },
    placeNative,
    get viewport() { return viewport; }, set viewport(value) { viewport = value; },
    get menu() { return menu; }, set menu(value) { menu = value; },
    get ask() { return ask; }, set ask(value) { ask = value; },
    get interactionPermissions() { return interactionPermissions(); }, get interactionState() { return interactionState; }, get interactionPending() { return interactionPending; }, toggleInteraction, releaseInteraction,
    spatialPrompts, get promptNodes() { return promptNodes; }, parkPrompt, closePrompt, movePrompt,
    get agents() { return agents; }, get agentIssue() { return agentIssue; }, get client() { return client; },
    get agentRows() { return agentRows; }, get selectedSession() { return selectedSession; }, selectAgent,
    get chatLog() { return chatLog; }, get replying() { return replying; }, get variant() { return variant; }, set variant(value) { if (agents.includes(value)) { variant = value; saveChat(); } },
    get nativeDraft() { return nativeDraft; }, get agentsChecking() { return agentsChecking; }, clearNativeDraft: () => { nativeDraft = ''; }, bindTerminalPrompt:(send:typeof terminalPrompt)=>{terminalPrompt=send},
    get canvasPromptMode() { return canvasPromptMode; }, setCanvasPromptMode, get canvasPromptDisabled() { return canvasPromptDisabled; },
    get autoOpenRenderTabs() { return autoOpenRenderTabs; }, setAutoOpenRenderTabs,
    get latestRender() { return latestRender; }, openRenderPreview,
    get chatReveal() { return chatReveal; },
    get host() { return host; }, set host(value) { host = value; },
    run, toggleTheme, view, drawScene, scrub, paint, open, choose, dismiss, remove, reshape, nextId, add, openMenu, openAsk, promptMenu, brew, label, solidLabel, setShapeMode, setSelectionMode, popup, linked: () => linked,
    get chips() { return chips; },
    get visible() { return visible; }, get adapter() { return adapter; },
    tools, pick, replay, get animationClips() { return animationClips; }, chooseAnimation, markReplay, frameLoaded: () => { lit = ''; }, toggleApp: () => view(liveBytes, true),
    detach: (id: string) => { detached = [...detached, id]; }, say, control
  };
}
