<script lang="ts">
  import {onMount, tick, untrack} from 'svelte';
  import {Terminal} from '@xterm/xterm';
  import {FitAddon} from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import {nodeBackend, type TerminalBackend} from './terminal/backends';
  import {browserPasteKey} from './contract/terminal-paste.js';
  import type {NodeClient} from './node.js';

  let {client, project, active, agents, checking,onpromptready}: {client: NodeClient | null; project:string; active: boolean; agents:string[]; checking:boolean;onpromptready:(send:((text:string)=>Promise<void>)|null)=>void} = $props();
  let host: HTMLDivElement, term: Terminal, fit: FitAddon, backend: TerminalBackend | null = null;
  let ready=$state(false), connected=false, epoch=0, terminalId='', controller:AbortController|undefined;
  const message=(value:string)=>term?.writeln(value.replace(/\r?\n/g,'\r\n'));
  function disconnect(){epoch++;controller?.abort();backend?.close();backend=null;connected=false}
  async function connect(){
    const target=client,current=epoch;terminalId=crypto.randomUUID();controller=new AbortController();
    try{
      const shell=await nodeBackend(target,bytes=>{if(current===epoch)term.write(bytes)},cause=>{
        if(current===epoch){connected=false;backend=null;message(cause?.message||'Shell exited.');}
      },undefined,controller.signal);
      if(current!==epoch){shell.close();return}
      backend=shell;connected=true;await tick();fit.fit();shell.resize?.(term.cols,term.rows);
      const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
      const label=project.replace(/[\x00-\x1f\x7f]/g,'');
      const banner=(agents.length?['Supported agents:',...agents]:['No supported agents installed.']).join('\\r\\n')+'\\r\\n\\r\\n';
      // Only this shell's prompt changes; keep the Vault's command/audit hooks intact.
      shell.input?.(`export ALEMBIC_TERMINAL_ID=${quote(terminalId)}; ALEMBIC_PROJECT_NAME=${quote(label)}; PS1='\${PWD/#\\/workspace/$ALEMBIC_PROJECT_NAME} $ '; PS2='> '; printf ${quote('\\033[2J\\033[3J\\033[H'+banner)}\r`);
      if(active)term.focus();
    }catch(cause){if(current===epoch)message((cause as Error).message)}
  }
  export function sessionId(){return terminalId}
  async function sendPrompt(text:string){
    const current=epoch,shell=backend;
    if(!connected||!shell?.input||!client||current!==epoch)throw new Error('No active session in terminal');
    // If the agent exits during delivery, this remains a harmless shell comment.
    const prompt='# '+text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g,' ');
    shell.input((term.modes.bracketedPasteMode?'\x1b[200~'+prompt+'\x1b[201~':prompt)+'\r');
    term.focus();
  }
  onMount(()=>{
    term=new Terminal({fontSize:12,fontFamily:'ui-monospace, monospace',convertEol:true,cursorBlink:true,
      theme:{background:'#242424',foreground:'#dedede',cursor:'#dedede'},scrollback:3000});
    term.attachCustomKeyEventHandler(browserPasteKey);
    fit=new FitAddon();term.loadAddon(fit);term.open(host);ready=true;
    onpromptready(sendPrompt);
    const input=term.onData(value=>{value=value.replace(/\x1b\[[IO]/g,'');if(connected&&value)try{backend?.input?.(value)}catch{message('Shell disconnected.')}});
    const observer=new ResizeObserver(()=>{if(active&&connected){fit.fit();backend?.resize?.(term.cols,term.rows)}});observer.observe(host);
    return()=>{onpromptready(null);disconnect();input.dispose();observer.disconnect();term.dispose()};
  });
  $effect(()=>{const target=client,waiting=checking;if(!ready)return;untrack(()=>{disconnect();term.reset();if(target&&!waiting)void connect()})});
  $effect(()=>{if(active&&ready)void tick().then(()=>{fit.fit();backend?.resize?.(term.cols,term.rows);if(connected)term.focus()})});
</script>
<section class="native-agent-terminal" aria-label="Sandbox terminal" style:display={active?'flex':'none'}>
  <div class="screen" bind:this={host}></div>
</section>
<style>
  .native-agent-terminal{display:flex;flex:1;min-height:0;flex-direction:column;background:#242424;color:#dedede}
  .screen{flex:1;min-height:0;padding:8px 4px;overflow:hidden}
</style>
