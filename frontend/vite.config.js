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
export default defineConfig({base: '/', appType: 'mpa', plugins: [svelte(),runtimeCatalog], resolve: {alias: {'@babylonjs/core': resolve(import.meta.dirname, 'node_modules/@babylonjs/core'), '@babylonjs/loaders': resolve(import.meta.dirname, 'node_modules/@babylonjs/loaders')}}, build: {emptyOutDir: false, rollupOptions:{preserveEntrySignatures:'strict',input:{index:resolve(import.meta.dirname,'index.html'),renderer:resolve(import.meta.dirname,'../render/babylon/runtime.js'),media:resolve(import.meta.dirname,'../render/media.js'),'dom-capture':resolve(import.meta.dirname,'src/contract/dom-capture.js')},output:{entryFileNames:chunk=>['renderer','media','dom-capture'].includes(chunk.name)?'assets/play/'+chunk.name+'.js':'assets/[name]-[hash].js'}}}});
