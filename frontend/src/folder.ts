import type {NodeClient} from './node.js';
export type Entry = {name: string; directory: boolean};
export interface Folder {
  name: string;
  writable: boolean;
  list(dir?: string, showInfrastructure?: boolean): Promise<Entry[]>;
  // Raw names, including hidden descriptor files; the visible list stays filtered.
  entries(dir?: string): Promise<Entry[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  stat(path: string): Promise<{size: number; lastModified: number}>;
  invalidate?(): void;
}
const parts = (path: string) => {
  const items = path.split('/');
  if (items.some(p => !p || p === '.' || p === '..' || p.includes('\\')))
    throw new Error('Invalid relative path');
  return items;
};
export function projectName(workspace: {path: string}, workspaces: {path: string}[]) {
  const parts = (path: string) => path.replace(/\/+$/, '').split('/').filter(Boolean);
  const path = parts(workspace.path), base = path.at(-1) || 'Folder';
  return workspaces.filter(row => parts(row.path).at(-1) === base).length > 1 ? path.slice(-2).join('/') : base;
}
const isTypedPackage = (path: string) => /\.(?:i3d|i2d|audio|iframe)$/i.test(path);
export function nodeFolder(client: NodeClient, name = 'Folder'): Folder {
  const directories = new Map<string, {until: number; value: Promise<any[]>}>();
  let revision = client.readRevision;
  function currentReads() {
    if (revision !== client.readRevision) { directories.clear(); treePolicy = undefined; revision = client.readRevision; }
  }
  function treeEntries(dir: string) {
    currentReads();
    const cached = directories.get(dir);
    if (cached && cached.until > Date.now()) return cached.value;
    if (directories.size > 128) directories.clear();
    const entry = {until: Infinity, value: client.tree(dir)};
    directories.set(dir, entry);
    entry.value.then(() => entry.until = Date.now() + 250, () => { if (directories.get(dir) === entry) directories.delete(dir); });
    return entry.value;
  }
  const missing = (path: string) => Object.assign(new Error(`Missing ${path}`), {name: 'NotFoundError'});
  // Explicit project paths and known renderer sidecars stay out of the ordinary tree.
  let treePolicy: {until: number; value: Promise<Set<string>>} | undefined;
  function hiddenPaths() {
    currentReads();
    if (treePolicy && treePolicy.until > Date.now()) return treePolicy.value;
    const value = (async () => {
      try {
        const data = JSON.parse(new TextDecoder().decode(await client.file('.alembic/tree.txt')));
        if (data.version !== 1 || !Array.isArray(data.hidden) || !data.hidden.every((p: unknown) => {
          if (typeof p !== 'string') return false;
          try { parts(p); return true; } catch { return false; }
        })) throw new Error('Invalid .alembic/tree.txt');
        return new Set<string>(data.hidden);
      } catch (error) {
        if (/^404\b/.test((error as Error).message)) return new Set<string>();
        throw error;
      }
    })();
    const policy = {until: Infinity, value}; treePolicy = policy;
    value.then(() => policy.until = Date.now() + 2500, () => { if (treePolicy === policy) treePolicy = undefined; });
    return value;
  }
  function invalidate() { client.invalidateReads(); currentReads(); }
  return {
    name, writable: true, invalidate,
    async entries(dir = '') {
      if (dir) parts(dir);
      return (await treeEntries(dir)).filter((e: any) => ['dir', 'file'].includes(e.kind))
        .map((e: any) => ({name: e.name, directory: e.kind === 'dir'}));
    },
    async list(dir = '', showInfrastructure = false) {
      if (dir) parts(dir);
      const [rows, hidden] = await Promise.all([treeEntries(dir), hiddenPaths()]);
      return rows.filter((e: any) => !e.name.startsWith('.') && ['dir', 'file'].includes(e.kind) &&
        !(isTypedPackage(dir) && e.name === 'manifest.json') &&
        (showInfrastructure || !hidden.has(dir ? `${dir}/${e.name}` : e.name) &&
          !(isTypedPackage(dir) && e.kind === 'file' && (['view.txt','exports.txt','playbacks.txt'].includes(e.name) || e.name.endsWith('.stream'))) &&
          !(e.kind === 'file' && e.name.endsWith('.uid'))))
        .map((e: any) => ({name: e.name, directory: e.kind === 'dir'}))
        .sort((a: Entry, b: Entry) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, {numeric: true}));
    },
    async read(path) {
      parts(path);
      try { return await client.file(path); }
      catch (error) { if (/^404\b/.test((error as Error).message)) throw missing(path); throw error; }
    },
    async write(path, data) { parts(path); try { await client.write(path, new Uint8Array(data)); } finally { invalidate(); } },
    async stat(path) {
      const items = parts(path), name = items.pop(), dir = items.join('/');
      if (path.includes('/__remote__/')) return {size: 0, lastModified: 0};
      const cached = directories.get(dir), settled = cached && cached.until !== Infinity;
      let entry = (await treeEntries(dir)).find((e: any) => e.name === name && e.kind === 'file');
      if (!entry && settled) {
        if (directories.get(dir) === cached) directories.delete(dir);
        entry = (await treeEntries(dir)).find((e: any) => e.name === name && e.kind === 'file');
      }
      if (!entry) { if (directories.get(dir) === cached) directories.delete(dir); throw missing(path); }
      return {size: entry.size, lastModified: Date.parse(entry.mtime)};
    }
  };
}
export async function optionalRead(folder: Folder, path: string) {
  try { return await folder.read(path); }
  catch (error) { if ((error as Error).name === 'NotFoundError') return null; throw error; }
}
