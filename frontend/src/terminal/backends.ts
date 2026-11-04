import type {NodeClient} from '../node.js';
export type Command = {name: string; usage: string};
export type RuntimeCommands = {commands: Command[]; invoke(line: string, signal: AbortSignal): Promise<unknown>; cancel(): void};
export type TerminalBackend = {
  commands: Command[];
  invoke(line: string): Promise<unknown>;
  cancel(): void;
  close(): void;
  input?(data: string): void;
  resize?(cols: number, rows: number): void;
};
export function format(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) ?? '';
}
export function webBackend(runtime: () => RuntimeCommands | null | undefined): TerminalBackend {
  let running: AbortController | null = null;
  return {
    get commands() { return [{name: 'help', usage: 'help'}, {name: 'clear', usage: 'clear'}, ...runtime()?.commands ?? []]; },
    async invoke(line) {
      const target = runtime(), name = line.trim().split(/\s+/)[0];
      if (name === 'help') return this.commands.map(command => command.usage).join('\n');
      if (!target?.commands.some(command => command.name === name)) throw new Error(`Unknown command: ${name}`);
      const current = running = new AbortController();
      try { return await target.invoke(line, current.signal); }
      finally { if (running === current) running = null; }
    },
    cancel() { running?.abort(); },
    close() { this.cancel(); }
  };
}
export async function nodeBackend(client: NodeClient, output: (data: string | Uint8Array) => void,
  exited: (error?: Error) => void, session?: string, signal?: AbortSignal): Promise<TerminalBackend> {
  const socket = session ? await client.attach(session) : await client.shell();
  if (signal?.aborted) { socket.close(); throw new Error('Closed'); }
  return new Promise((resolve, reject) => {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true; signal?.removeEventListener('abort', abort);
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close();
    };
    const fail = (message: string, error = false) => { const reason = new Error(message); close(); reject(reason); exited(error ? reason : undefined); };
    const abort = () => { close(); reject(new Error('Closed')); };
    const input = (data: string) => {
      if (closed || socket.readyState !== WebSocket.OPEN) throw new Error('Disconnected');
      socket.send(data);
    };
    signal?.addEventListener('abort', abort, {once: true});
    socket.onmessage = event => output(typeof event.data === 'string' ? event.data : new Uint8Array(event.data));
    socket.onerror = () => fail('Connection failed', true);
    socket.onclose = () => fail('Disconnected');
    socket.onopen = () => resolve({
      commands: [], invoke: async line => input(line + '\r'), input,
      resize: (cols, rows) => input('\0' + JSON.stringify({resize: [cols, rows]}) + '\n'),
      cancel: () => input('\x03'), close
    });
  });
}
