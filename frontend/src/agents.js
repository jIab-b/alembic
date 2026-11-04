export const sessionKey = row => row.external && row.pid ? `pid:${row.pid}` : row.id;
export const agentLabel = name => ({codex: 'Codex', opencode: 'OpenCode', claude: 'Claude'})[name?.split('/').pop()] || name?.split('/').pop() || '';
export function mergeSession(rows, row) {
  const previous = rows.find(item => sessionKey(item) === sessionKey(row));
  const next = {...previous, ...row, last_command: Math.max(previous?.last_command || 0, row.last_command || 0)};
  return [...rows.filter(item => sessionKey(item) !== sessionKey(row)), next];
}
export function commandSession(event, vm) {
  if (event.kind !== 'agent.command' || event.vm !== vm || !event.agent || (!event.session && !event.pid)) return null;
  return {id: event.session || undefined, agent: event.agent, pid: event.pid, external: event.external,
    attachable: event.attachable, last_command: event.last_command};
}
