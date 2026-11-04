import {aliases, entries} from '../render/build.js';
import {defineConfig} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import { existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const runtimeCatalog = {name: 'runtime-catalog', configureServer(server) {
  server.middlewares.use((request, response, next) => {
    if (request.url?.split('?')[0] === '/assets/play/dom-capture.js')
      request.url = '/src/contract/dom-capture.js';
    next();
  });
}, generateBundle() {
  for(const ext of ['html','js'])this.emitFile({type:'asset',fileName:'assets/runtimes/worker-host.'+ext,
    source:readFileSync(new URL('../render/worker-host.'+ext,import.meta.url))});
  if (!existsSync(new URL('./public/assets/runtimes/manifest.json', import.meta.url)))
    this.emitFile({type: 'asset', fileName: 'assets/runtimes/manifest.json', source: '[]\n'});
}};
// mpa: missing files 404 like nginx in production, instead of falling back to index.html.
// Open tabs still import chunks from their original build; keep those and runtime preview discovery.
export default defineConfig({
  base: '/', publicDir: process.env.AL_PUBLIC_DIR || 'public', appType: 'mpa', plugins: [svelte(), runtimeCatalog],
  resolve: {alias: aliases},
  build: {emptyOutDir: false, rollupOptions: {
    preserveEntrySignatures: 'strict',
    input: {index: resolve(import.meta.dirname, 'index.html'), ...entries,
      'dom-capture': resolve(import.meta.dirname, 'src/contract/dom-capture.js')},
    output: {entryFileNames: chunk => [...Object.keys(entries), 'dom-capture'].includes(chunk.name)
      ? 'assets/play/' + chunk.name + '.js' : 'assets/[name]-[hash].js'}
  }}
});
