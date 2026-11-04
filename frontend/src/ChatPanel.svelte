<script lang="ts">
  import {onMount} from 'svelte';
  import {Connections} from './contract/connections.svelte.js';
  import NativeAgentTerminal from './NativeAgentTerminal.svelte';
  import type {NodeClient} from './node.js';
  let {client,project,nativeDraft,onclearNativeDraft,onpromptready,agents,checking,issue,open,ontoggle}: {
    client:NodeClient|null;project:string;nativeDraft:string;onclearNativeDraft:()=>void;onpromptready:(send:((text:string)=>Promise<void>)|null)=>void;agents:string[];checking:boolean;issue:string;open:boolean;ontoggle:()=>void
  }=$props();
  let terminal:NativeAgentTerminal,copyError=$state('');
  let connections=$state(new Connections()),embedded:((text:string)=>Promise<void>)|null=null;
  onMount(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>,target=client;
    const poll=async()=>{if(target!==client){target=client;connections=new Connections()}if(!document.hidden&&client)try{await connections.poll(client,terminal?.sessionId()||'')}catch(e){connections.rows=[];connections.error=(e as Error).message}if(!stopped)timer=setTimeout(poll,1000)};void poll();
    return()=>{stopped=true;clearTimeout(timer)};
  });
  async function send(text:string){await connections.send(client,embedded,text)}
  const helpId=$props.id();
  const selectable=$derived(connections.rows.filter(connections.connected).length>1);
  async function copyPrompt(){
    try{await navigator.clipboard.writeText(nativeDraft);onclearNativeDraft();copyError=''}catch{copyError='Clipboard unavailable. Copy the prepared prompt below.'}
  }
</script>
<div class="chat" class:closed={!open}>
  <header>
    <button class="collapse" aria-label={open?'Collapse agent':'Open agent'} aria-expanded={open} onclick={ontoggle}>{open?'‹':'›'}</button>
    {#if open}<button class="help" aria-label="Agent connection" title={connections.rows.some(connections.connected)?'Connected':'Not connected'} popovertarget={helpId}><span class="connection-dot" class:on={connections.rows.some(connections.connected)}></span></button>{/if}
  </header>
  <div id={helpId} popover="auto" class="help-content">
    {#each connections.rows as row (row.id)}
      <div class="session-row">
        {#if selectable && connections.connected(row)}
          <button onclick={()=>connections.selected=row.id}>
            {connections.selected===row.id?'✓ ':''}{row.program.name}{row.external?'':' (embedded)'}
          </button>
        {:else}<span>{row.program.name}{row.external?'':' (embedded)'}</span>{/if}
        <button onclick={()=>connections.toggle(row)}>{connections.connected(row)?'Disconnect':'Reconnect'}</button>
      </div>
    {:else}<p>No agents connected</p>{/each}
    {#if connections.error}<p role="status">{connections.error}</p>{/if}
    {#if issue}<p role="status">{issue}</p>{/if}
    {#if nativeDraft}<button onclick={copyPrompt}>Copy prepared prompt</button><button onclick={onclearNativeDraft}>Dismiss prepared prompt</button>{/if}
    {#if copyError && nativeDraft}<p role="alert">{copyError}</p><textarea readonly value={nativeDraft} aria-label="Prepared agent prompt"></textarea>{/if}
  </div>
  <div class="agent-body" class:hidden={!open}><NativeAgentTerminal bind:this={terminal} {client} {project} active={open} {agents} {checking} onpromptready={sendEmbedded=>{embedded=sendEmbedded;onpromptready(sendEmbedded?send:null)}} /></div>
</div>
<style>
  .chat{position:relative;display:flex;flex-direction:column;height:100%;min-width:0;min-height:0}
  header{flex:none;display:flex;align-items:center;gap:6px;min-height:38px;padding:4px 12px;border-bottom:1px solid var(--line)}
  .help{anchor-name:--agent-connection;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;background:none;cursor:pointer;outline:none}
  .help:hover{background:none}
  .help:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .connection-dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}.connection-dot.on{background:#5fcf87}.session-row{display:flex;align-items:center;gap:8px;justify-content:space-between;white-space:nowrap}
  .help-content{position-anchor:--agent-connection;position-area:bottom span-left;margin:4px 0 0;width:max-content;max-width:280px;padding:4px 6px;border:1px solid var(--line-strong);border-radius:7px;background:var(--panel);color:var(--text);font-size:12px;box-shadow:var(--shadow)}
  .help-content p{margin:3px 0;line-height:1.5}.help-content button{padding:2px 4px;font-size:12px}.help-content textarea{width:100%;min-height:90px}
  .agent-body{display:flex;flex:1;min-height:0;flex-direction:column}.agent-body.hidden{display:none}
  .closed header{flex-direction:column;padding:11px 5px;border:0}
</style>
