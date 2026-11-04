// Real acceptance: no mocked node, hooks, transport, history, or sandbox.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {access, mkdir, mkdtemp, readFile, writeFile, symlink, readdir, readlink, rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir, userInfo} from 'node:os';
import {dirname, resolve, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const tests = dirname(fileURLToPath(import.meta.url)), repo = dirname(tests), out = join(tests, 'out/e2e');
const run = promisify(execFile), delay = ms => new Promise(r => setTimeout(r, ms));
const skip = reason => { console.log('SKIP real-e2e: ' + reason.replace(/\s+/g, ' ')); process.exit(0); };
const missing = ['PLAYWRIGHT_MODULE', 'CHROMIUM_PATH'].filter(k => !process.env[k]);
if (missing.length) skip('unset ' + missing.join(', ') + '; set both to real Playwright and Chromium paths');
let chromium, release, budgets;
const source = resolve(process.env.VPSCTL_HOME || join(homedir(), 'vspctl'));
const provenance = join(homedir(), 'vspctl/musings/provenance.txt');
try {
  ({chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE));
  await access(process.env.CHROMIUM_PATH, constants.X_OK);
  await access(join(repo, 'frontend/dist/index.html')); await access(join(source, 'vpsctl/sandbox.py'));
  release = join(homedir(), '.local/share/vpsctl/releases', (await readFile(join(repo, 'vault.lock'), 'utf8')).trim());
  for (const name of ['sandbox_worker', 'isolator', 'statectl']) await access(join(release, 'bin', name), constants.X_OK);
  budgets = (await readFile(provenance, 'utf8')).match(/Light by design\s+About (\d+)-(\d+) MB for the runtime[\s\S]*?<= (\d+) MB per extra/);
  assert.ok(budgets, 'Cannot locate Light by design footprint budgets in ' + provenance);
  await run('python3.12', ['-c', 'import shutil; assert all(shutil.which(x) for x in ["bwrap","ssh","ssh-keygen","flock"]), "requires bwrap, OpenSSH and flock"']);
} catch (e) {
  if (['ENOENT', 'EACCES', 'MODULE_NOT_FOUND'].includes(e.code) || e.stderr?.includes('requires bwrap')) skip('missing prerequisite: ' + e.message);
  throw e;
}
// Short paths keep the real Unix sockets below sockaddr_un's limit. HOME contains no login files.
const root = await mkdtemp('/tmp/ae-'), project = join(root, 'project'), bin = join(root, 'bin');
const env = {PATH: bin + ':' + process.env.PATH, HOME: join(root, 'home'), USER: userInfo().username,
  VPSCTL_HOME: source, SW_STORE: join(root, 'store'), XDG_RUNTIME_DIR: join(root, 'run'),
  XDG_CONFIG_HOME: join(root, 'home/.config'), XDG_CACHE_HOME: join(root, 'cache'), TMPDIR: root,
  BROWSER: '/bin/true', PYTHONDONTWRITEBYTECODE: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'};
let browser, page, launcher, external, config, vault, extra, log = '', startup = '', failed = false;
const tracked = new Map(), results = [], launched = new Map();
async function proc(pid) {
  try { const f = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(/\) /).at(-1).split(' ');
    return {pid: Number(pid), parent: Number(f[1]), start: f[19], state: f[0]}; } catch (e) { if (['ENOENT', 'ESRCH'].includes(e.code)) return null; throw e; }
}
async function observe() {
  const rows = (await Promise.all((await readdir('/proc')).filter(p => /^\d+$/.test(p)).map(proc))).filter(Boolean);
  const ours = new Set([process.pid, ...rows.filter(p => tracked.get(p.pid)?.start === p.start).map(p => p.pid)]); let changed = true;
  while (changed) { changed = false; for (const p of rows) if (!ours.has(p.pid) && ours.has(p.parent)) { ours.add(p.pid); changed = true; } }
  for (const p of rows) {
    const cwd = await readlink(`/proc/${p.pid}/cwd`).catch(() => '');
    if (p.pid !== process.pid && (ours.has(p.pid) || cwd === root || cwd.startsWith(root + '/'))) tracked.set(p.pid, p);
  }
}
async function live(rows = [...tracked.values()]) {
  return (await Promise.all(rows.map(async p => { const now = await proc(p.pid); return now?.start === p.start && now.state !== 'Z' ? now : null; }))).filter(Boolean);
}
async function until(check, message, timeout = 20000) {
  const end = Date.now() + timeout; let cause;
  do { try { if (await check()) return; } catch (e) { cause = e.message; } await delay(150); } while (Date.now() < end);
  throw new Error(message + (cause ? ': ' + cause : ''));
}
async function py(code) {
  const prelude = `import sys,json; sys.path.insert(0,${JSON.stringify(source)}); import vpsctl as vc\n`;
  const {stdout} = await run('python3.12', ['-c', prelude + code], {env, cwd: project, timeout: 20000, maxBuffer: 2 ** 20});
  return JSON.parse(stdout.trim());
}
const ws = `vc.workspace(${JSON.stringify(project)})`, vm = () => `vc.VM.from_id(${JSON.stringify(config.vm)})`;
const history = () => py(`print(json.dumps(${ws}.log(limit=100)))`);
const sessions = () => py(`print(json.dumps(${vm()}.sessions()))`);
async function file(name) { return py(`print(json.dumps(${ws}.file(${JSON.stringify(name)}).decode()))`); }
const treeFile = name => page.getByRole('navigation', {name: 'Files', exact: true}).getByRole('button', {name, exact: true});
async function tree(name) { await treeFile(name).waitFor({timeout: 20000}); }
const connector = () => page.locator('summary[aria-label="Agent connection"]').getAttribute('title');
// Agents start on the host through the Python API, as a user would; the browser only picks them from the connector.
const hosted = [];
function host(name) {
  const code = `import sys; sys.path.insert(0,${JSON.stringify(source)}); import vpsctl as vc\nvc.VM.from_id(${JSON.stringify(config.vm)}).launch(${JSON.stringify(name)}).wait()`;
  hosted.push(spawn('python3.12', ['-c', code], {env, cwd: project, stdio: 'ignore'}));
}
async function terminal(command) {
  await page.locator('#terminal-panel .xterm-helper-textarea').focus();
  await page.keyboard.type(command); await page.keyboard.press('Enter');
}
async function step(n, title, body) {
  const shot = join(out, String(n).padStart(2, '0') + '.png');
  let detail = '', error;
  try { if (n === 10) await page.screenshot({path: shot});
    assert.ok(page && config, startup || 'launcher did not supply a connection'); detail = await body() || ''; } catch (e) { error = e; failed = true; }
  try { if (n !== 10) { assert.ok(page, 'Chromium page unavailable'); await page.screenshot({path: shot}); } } catch (e) { error ||= e; failed = true; }
  await observe(); const result = {n, title, detail, error, shot}; results.push(result); if (n < 9) report(result);
}
function report(result) {
  const {n, title, detail, error, shot} = result;
  const message = error ? error.message + (detail ? '; ' + detail : '') : detail || 'ok';
  console.log(`${error ? 'FAIL' : 'PASS'} ${n}. ${title}: ${message.replace(/\s+/g, ' ')} [${shot}]`);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM'); await until(() => child.exitCode !== null || child.signalCode !== null, 'owned child failed to terminate', 10000);
}
async function rss() {
  const values = [];
  for (let i = 0; i < 3; i++) { const s = await readFile(`/proc/${vault.pid}/status`, 'utf8'); values.push(Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1]) / 1024); await delay(500); }
  assert.ok(values.every(Number.isFinite), 'Cannot measure vault RSS'); return Math.max(...values);
}
let memory, shutdownError, sandboxPids = [];
try {
  await mkdir(out, {recursive: true});
  for (const dir of [project, bin, env.HOME, env.XDG_RUNTIME_DIR, env.XDG_CACHE_HOME]) await mkdir(dir, {recursive: true});
  const pinDir = join(env.HOME, '.local/share/vpsctl/releases'); await mkdir(pinDir, {recursive: true});
  await symlink(release, join(pinDir, basename(release)), 'dir');
  await writeFile(join(project, 'one.txt'), 'one\n'); await writeFile(join(project, 'two.txt'), 'two\n');
  for (const name of ['claude', 'codex', 'opencode']) await writeFile(join(bin, name), `#!/bin/sh
set -eu
# Invoke the product's local shell client.
send() { "$VPS_SHELL" "$@"; }
if [ $# -gt 0 ]; then
  # A chat variant run: the last argument is the message; one JSON line satisfies every variant's parser.
  for message; do :; done
  printf '%s\\n' "$message" | send 'cat >> ${name}-chat.txt'
  printf '%s\\n' '{"result":"${name} ok","session_id":"s1","thread_id":"s1","sessionID":"s1","type":"text","part":{"text":"${name} ok"},"item":{"type":"agent_message","text":"${name} ok"}}'
  exit 0
fi
send 'echo ${name} > from-${name}.txt' </dev/null
while IFS= read -r line; do printf '%s\\n' "$line" | send 'cat >> ${name}-stdin.txt'; done
sleep 86400 & wait
`, {mode: 0o700});
  // Do not interfere with another user's live singleton vault.
  const identity = join('/tmp', 'vpsctl-' + process.getuid(), 'vault.json');
  const prior = await readFile(identity, 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; });
  const previous = prior && await proc(prior.pid);
  if (previous && previous.state !== 'Z' && (!prior.started || previous.start === prior.started)) {
    await rm(root, {recursive: true, force: true}); skip('exclusive real vault unavailable: existing vault PID ' + prior.pid + '; stop it before running');
  }
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, headless: true, env,
    args: ['--no-sandbox', '--disable-dev-shm-usage']});
  page = await browser.newPage({viewport: {width: 1440, height: 960}}); page.setDefaultTimeout(20000);
  launcher = spawn(join(repo, 'launch.sh'), ['--vault', project], {env, cwd: project, stdio: ['ignore', 'pipe', 'pipe']});
  launcher.on('error', e => { startup = e.message; });
  launcher.stdout.on('data', b => { log += b; }); launcher.stderr.on('data', b => { log += b; });
  try {
    await until(() => /http:\/\/127\.0\.0\.1:\d+\/#\S+/.test(log) || launcher.exitCode !== null || startup, 'launcher URL timeout', 40000);
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+\/#\S+/)?.[0]; assert.ok(url, 'launcher exited before printing its URL: ' + log);
    config = Object.fromEntries(new URLSearchParams(new URL(url).hash.slice(1)));
    await page.goto(url, {waitUntil: 'domcontentloaded'});
    vault = await readFile(identity, 'utf8').then(JSON.parse); assert.equal(vault.store, env.SW_STORE);
  } catch (e) { startup = e.message; }
  await step(1, 'vault origin, tree and folder title', async () => {
    assert.ok(!startup, startup); assert.equal(new URL(page.url()).origin, config.node, 'page must come from vault origin');
    const response = await page.request.get(config.node + '/version', {headers: {Authorization: 'Bearer ' + config.token}});
    assert.ok(response.ok(), 'vault /version unavailable'); const version = await response.json();
    assert.equal(String(version.pid), String(vault.pid), 'UI origin must be the actual vault');
    assert.equal((await py(`print(json.dumps(${vm()}.status()))`)).isolation, 'bwrap', 'requires real bwrap, never host execution');
    await tree('one.txt'); await tree('two.txt');
    assert.ok((await page.title()).includes(basename(project)), `folder missing from browser title: ${JSON.stringify(await page.title())}`);
  });
  await step(2, 'reload retains connection', async () => {
    await page.reload(); await tree('one.txt'); await tree('two.txt');
    assert.equal(new URL(page.url()).origin, config.node); await page.getByRole('combobox', {name: 'Chat variant', exact: true}).isEnabled().then(v => assert.ok(v, 'agent picker disconnected after reload'));
  });
  await step(3, 'sandbox terminal records probe', async () => {
    await page.getByRole('button', {name: 'Terminal', exact: true}).click();
    await page.locator('#terminal-panel .toolbar span').filter({hasText: /\S/}).waitFor(); await terminal('echo hi > probe.txt'); await tree('probe.txt');
    assert.equal(await file('probe.txt'), 'hi\n');
    await until(async () => (await history()).some(r => r.commit && r.outputs?.some(o => o.path === 'probe.txt')), 'product gap: vc workspace.log() never records terminal probe.txt');
  });
  await step(4, 'real home is confined', async () => {
    await terminal(`command -v cat >/dev/null && if cat '${provenance.replaceAll("'", "'\\''")}' >/dev/null 2>&1; then echo exposed > confinement.txt; else echo blocked > confinement.txt; fi`);
    await tree('confinement.txt'); assert.equal(await file('confinement.txt'), 'blocked\n', 'CONFINEMENT GAP: terminal can read real home outside project');
    await page.getByRole('button', {name: 'confinement.txt', exact: true}).click();
  });
  await step(5, 'fake agent dropdown', async () => {
    const options = await page.getByRole('combobox', {name: 'Chat variant', exact: true}).locator('option').allTextContents();
    for (const name of ['claude', 'codex', 'opencode']) assert.ok(options.includes(name), 'product gap: dropdown missing ' + name);
  });
  await step(6, 'chat runs codex and shows its reply', async () => {
    assert.equal(await connector(), 'Not connected', 'chat is connected to another session');
    await page.getByRole('combobox', {name: 'Chat variant', exact: true}).selectOption('codex');
    const composer = page.getByRole('textbox', {name: 'Message the agent', exact: true}), message = 'e2e-chat-' + basename(root);
    await composer.fill(message); await composer.press('Enter');
    await page.locator('.conversation li.agent', {hasText: 'codex ok'}).waitFor({timeout: 20000}); await tree('codex-chat.txt');
    await until(async () => (await file('codex-chat.txt')).split(/\r?\n/).includes(message), 'product gap: chat message did not reach codex');
  });
  await step(7, 'external opencode connects and greys out the chat', async () => {
    const shell = await py(`print(json.dumps(${vm()}.shell_command()))`); // Product local shell command, no UI launch or actor injection.
    external = spawn(join(bin, 'opencode'), [], {env: {...env, VPS_SHELL: shell}, cwd: project, stdio: ['pipe', 'ignore', 'pipe']});
    external.on('error', e => { startup = e.message; }); external.stderr.on('data', b => { log += b; });
    await tree('from-opencode.txt'); assert.equal(await file('from-opencode.txt'), 'opencode\n');
    await until(async () => await connector() === 'Connected', 'product gap: external shell command never connects');
    assert.equal(await page.getByRole('textbox', {name: 'Message the agent', exact: true}).isEnabled(), false, 'chat not greyed out while connected');
  });
  await step(8, 'parallel claude and codex have distinct actors', async () => {
    await stop(external);
    host('claude'); host('codex'); await tree('from-claude.txt'); await tree('from-codex.txt');
    assert.equal(await file('from-claude.txt'), 'claude\n'); const rows = await sessions();
    for (const name of ['claude', 'codex']) { const row = rows.find(r => r.agent === name && !r.external); const p = row && await proc(row.pid); assert.ok(row?.id && p && p.state !== 'Z', name + ' is not running in parallel'); launched.set(name, row); }
    await until(async () => { const records = await history(); return ['claude', 'codex'].every(name => records.some(r => r.actor === launched.get(name).id && r.outputs?.some(o => o.path === `from-${name}.txt`))); }, 'product gap: records lack distinct claude/codex session actors');
    assert.notEqual(launched.get('claude').id, launched.get('codex').id);
  });
  // Step 9's idle measurement is deferred until Ctrl+C yields zero live VMs in step 10.
  await step(9, 'vault RSS idle and with two sandboxes', async () => {
    assert.ok(vault, 'vault identity unavailable'); const one = await rss();
    const vms = () => py('from vpsctl import sandbox; print(json.dumps(sandbox._request("GET","/vms")))');
    assert.equal((await vms()).length, 1, 'one-sandbox RSS requires exactly one live VM');
    extra = await py(`v=vc.vm(wspc=${JSON.stringify(project)},isolation='light'); print(json.dumps(v.id))`);
    const status = await py(`print(json.dumps(vc.VM.from_id(${JSON.stringify(extra)}).status()))`); assert.equal(status.isolation, 'bwrap');
    assert.equal((await vms()).length, 2, 'two-sandbox RSS requires exactly two live VMs');
    const two = await rss(); memory = {one, two};
    await py(`print(json.dumps(vc.VM.from_id(${JSON.stringify(extra)}).stop()))`); extra = null;
  });
  try {
    sandboxPids = [...(await py(`print(json.dumps(${vm()}.status()))`)).procs.map(p => p.pid), ...(await sessions()).filter(r => !r.external).map(r => r.pid)];
    await observe(); launcher.kill('SIGINT'); await until(() => launcher.exitCode !== null, 'product gap: launcher did not exit on Ctrl+C', 15000);
    assert.equal(launcher.exitCode, 0, 'launcher Ctrl+C exit code');
    const opened = await py('from vpsctl import sandbox; print(json.dumps(sandbox._request("GET","/vms")))');
    assert.equal(opened.length, 0, 'product gap: launcher left live VMs');
    await until(async () => !(await live([...tracked.values()].filter(p => sandboxPids.includes(p.pid) || [...launched.values()].some(r => r.pid === p.pid)))).length, 'product gap: launcher left sandbox/agent processes');
    if (memory) memory.idle = await rss();
  } catch (e) { shutdownError = e; }
  const footprint = results.find(r => r.n === 9);
  if (memory) {
    footprint.detail = `RSS MB: idle=${memory.idle?.toFixed(2)}, one=${memory.one.toFixed(2)}, two=${memory.two.toFixed(2)}; budgets runtime ${budgets[1]}-${budgets[2]}, extra <=${budgets[3]}`;
    try { assert.ok(Number.isFinite(memory.idle), 'idle RSS unavailable: ' + shutdownError?.message); assert.ok(memory.idle <= Number(budgets[2]), 'footprint gap: idle runtime exceeds budget');
      assert.ok(memory.one - memory.idle <= Number(budgets[3]) && memory.two - memory.one <= Number(budgets[3]), 'footprint gap: per-sandbox RSS exceeds budget'); }
    catch (e) { footprint.error ||= e; failed = true; }
  }
  report(footprint);
  await step(10, 'Ctrl+C stops VM and leaves no owned processes', async () => {
    if (shutdownError) throw shutdownError;
    await browser.close(); browser = null;
    process.kill(Number(vault.pid), 'SIGTERM'); await until(async () => { await observe(); return !(await live()).length; }, 'owned processes remain after VM stop and temporary vault/browser teardown', 15000);
  }); report(results.at(-1));
} catch (e) { failed = true; console.log('FAIL real-e2e setup: ' + e.message.replace(/\s+/g, ' ')); }
finally {
  await observe();
  // Emergency cleanup never changes a failed acceptance result; signal only identities observed as ours.
  for (const p of await live()) { try { process.kill(p.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
  for (const child of hosted) await stop(child).catch(() => {});
  await browser?.close().catch(() => {}); await delay(1000);
  for (const p of await live()) { try { process.kill(p.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
  await writeFile(join(out, 'launcher.log'), log.replace(/token=[^&\s]+/g, 'token=REDACTED'));
  await rm(root, {recursive: true, force: true});
}
process.exitCode = failed ? 1 : 0;
