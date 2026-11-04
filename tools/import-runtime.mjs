#!/usr/bin/env node
// Vendor a built runtime bundle, unchanged, into frontend/public/runtimes/<name>/ and declare it in
// runtimes/manifest.json with its source commit and per-file sha256 (the record deploys are pinned to).
//   node tools/import-runtime.mjs <bundle dir> '<declaration json>'
// Declaration: {name, title, file (example to open), description, formats (JSON "format" values it
// opens), open (URL template; {file} = blob URL of the file, {theme} = light|dark)}.
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [source, text] = process.argv.slice(2);
const declaration = JSON.parse(text);
if (!/^[a-z0-9-]+$/.test(declaration.name)) throw new Error('runtime name must match [a-z0-9-]+');
const root = fileURLToPath(new URL('../frontend/public/runtimes/', import.meta.url)), target = join(root, declaration.name);
await rm(target, { recursive: true, force: true });
await cp(resolve(source), target, { recursive: true });
const files = {};
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files[relative(target, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
}
await walk(target);
const git = (...args) => execFileSync('git', ['-C', resolve(source), ...args], { encoding: 'utf8' }).trim();
const repo = git('rev-parse', '--show-toplevel');
// dirty: the source repo had uncommitted changes, so the commit alone cannot rebuild these bytes.
const provenance = { repo, path: relative(repo, resolve(source)), commit: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain').length > 0, files: Object.fromEntries(Object.entries(files).sort()) };
const manifestPath = join(root, 'manifest.json');
let manifest = [];
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
manifest = [...manifest.filter(item => item.name !== declaration.name), { ...declaration, source: provenance }]
  .sort((a, b) => a.name.localeCompare(b.name));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${declaration.name}: ${Object.keys(files).length} files from ${provenance.commit}${provenance.dirty ? ' + uncommitted changes' : ''}`);
