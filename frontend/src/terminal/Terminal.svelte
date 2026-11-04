<script lang="ts">
  import {onMount, tick, untrack} from 'svelte';
  import {Terminal} from '@xterm/xterm';
  import {FitAddon} from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import {format, nodeBackend, webBackend, type RuntimeCommands, type TerminalBackend} from './backends';
  import {browserPasteKey} from '../contract/terminal-paste.js';
  import type {NodeClient} from '../node.js';
  let {active, onclose, runtime, client, root}: {active: boolean; onclose: () => void; runtime: RuntimeCommands | null | undefined; client: NodeClient | null; root: string} = $props();
  let mode = $state('sandbox'), error = $state(''), connected = $state(false), busy = $state(false);
  let host: HTMLDivElement, term: Terminal, fit: FitAddon, backend: TerminalBackend;
  let controller: AbortController | undefined;
  let ready = $state(false), line = '', history: string[] = [], index = 0, epoch = 0;
  const web = webBackend(() => runtime);
  const write = (value: string) => term?.write(value.replace(/\r?\n/g, '\r\n'));
  const prompt = () => { if (mode === 'web') write('web> '); };
  function cancel() { try { backend?.cancel(); } catch { error = 'Disconnected'; } }
  function stop() { epoch++; controller?.abort(); backend?.close(); backend = web; connected = false; busy = false; }
  async function select() {
    stop(); error = ''; line = ''; term?.reset();
    if (mode === 'web') { prompt(); return; }
    if (!client) { error = 'Disconnected'; return; }
    const current = epoch; busy = true; controller = new AbortController();
    try {
      const local = await nodeBackend(client, data => { if (current === epoch) term.write(data); }, () => { if (current === epoch) { connected = false; backend = web; } }, undefined, controller.signal);
      if (current !== epoch) { local.close(); return; }
      backend = local; connected = true; fit.fit(); backend.resize?.(term.cols, term.rows); term.focus();
    } catch (cause) { if (current === epoch) error = (cause as Error).message; }
    finally { if (current === epoch) busy = false; }
  }
  async function submit() {
    const command = line.trim(); line = ''; write('\n');
    if (!command) { prompt(); return; }
    history.push(command); index = history.length;
    if (command === 'clear') { term.clear(); prompt(); return; }
    const current = epoch; busy = true;
    try { const value = await backend.invoke(command); if (current === epoch) write(format(value) + '\n'); }
    catch (cause) { if (current === epoch) write((cause as Error).message + '\n'); }
    finally { if (current === epoch) { busy = false; prompt(); } }
  }
  onMount(() => {
    term = new Terminal({fontSize: 13, fontFamily: 'ui-monospace, monospace', convertEol: true, cursorBlink: true,
      theme: {background: '#323c4b', foreground: '#f5f1eb', cursor: '#e28a67'}, scrollback: 3000});
    term.attachCustomKeyEventHandler(browserPasteKey);
    fit = new FitAddon(); term.loadAddon(fit); term.open(host); backend = web; ready = true;
    const data = term.onData(value => {
      if (mode === 'sandbox') { if (connected) { try { backend.input?.(value); } catch { error = 'Disconnected'; } } return; }
      if (value === '\x03') { cancel(); if (!busy) { line = ''; write('^C\n'); prompt(); } return; }
      if (busy) return;
      if (value === '\r') { void submit(); return; }
      if (value === '\x7f') { if (line) { line = line.slice(0, -1); write('\b \b'); } return; }
      if (value === '\x1b[A' || value === '\x1b[B') {
        index = Math.max(0, Math.min(history.length, index + (value === '\x1b[A' ? -1 : 1)));
        line = history[index] ?? ''; write('\r\x1b[2Kweb> ' + line); return;
      }
      if (value.startsWith('\x1b')) return;
      const text = value.replace(/[\x00-\x1f\x7f]/g, ' '); line += text; write(text);
    });
    const observer = new ResizeObserver(() => { if (active) { fit.fit(); backend.resize?.(term.cols, term.rows); } }); observer.observe(host);
    return () => { stop(); data.dispose(); observer.disconnect(); term.dispose(); };
  });
  $effect(() => {
    const identity = client;
    if (!ready) return;
    // A changed node closes the old shell.
    void identity; untrack(() => { stop(); mode = 'sandbox'; error = ''; line = ''; term.reset(); if (active && client) void select(); });
  });
  $effect(() => { if (active && ready) untrack(() => {
    if (mode === 'sandbox' && !connected && !busy && client) void select();
    void tick().then(() => { fit.fit(); backend.resize?.(term.cols, term.rows); term.focus(); });
  }); });
</script>

<section class="terminal" aria-label="Terminal" style:display={active ? 'flex' : 'none'}>
  <div class="toolbar">
    <strong>Terminal</strong>
    <select aria-label="Terminal backend" bind:value={mode} onchange={() => void select()}>
      <option value="web">Scene commands</option><option value="sandbox">Sandbox shell</option>
    </select>
    <span>{mode === 'web' ? '' : connected ? root : ''}</span>
    {#if mode === 'sandbox' && !connected}<button disabled={busy} onclick={() => void select()}>Connect</button>{/if}
    <button aria-label="Hide terminal" title="Hide terminal" onclick={onclose}>×</button>
  </div>
  {#if error}<div class="error" role="alert">{error}</div>{/if}
  <div class="screen" bind:this={host}></div>
</section>

<style>
  .terminal { flex: 1; flex-direction: column; min-height: 0; min-width: 0; background: #323c4b; }
  .toolbar { display: flex; flex-shrink: 0; overflow-x: auto; align-items: center; gap: 7px; min-height: 36px; padding: 4px 10px; background: var(--panel); border-bottom: 1px solid var(--line); font-size: 11px; }
  select, button { padding: 4px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--field); }
  strong { font-weight: 500; }
  span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); }
  .screen { flex: 1; min-height: 0; min-width: 0; padding: 10px 4px 4px 10px; overflow: hidden; }
  .error { padding: 6px 10px; color: var(--danger); font-size: 12px; }
</style>
