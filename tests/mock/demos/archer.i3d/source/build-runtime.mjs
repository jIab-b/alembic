// Optional: ALEMBIC_ROOT=/path/to/al_web node build-runtime.mjs
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.env.ALEMBIC_ROOT;
if(!root)throw Error('Set ALEMBIC_ROOT to the host repository with pinned frontend dependencies');
const here=dirname(fileURLToPath(import.meta.url));
const {rolldown}=await import(pathToFileURL(resolve(root,'frontend/node_modules/rolldown/dist/index.mjs')));
const shared=new Map([['Engines/engine.js','Engine'],['scene.js','Scene']]);
const bundle=await rolldown({
 input:resolve(here,'runtime.source.js'),
 external:['/assets/play/renderer.js'],
 plugins:[{name:'pinned-babylon',resolveId(id,importer){
  if(id.startsWith('@babylonjs/core/'))return resolve(root,'frontend/node_modules',id);
  if(importer&&id.startsWith('.')){
   const path=resolve(dirname(importer),id),key=path.split('/@babylonjs/core/')[1];
   if(shared.has(key))return '\0shared:'+key;
  }
 },load(id){if(id.startsWith('\0shared:'))return `export {${shared.get(id.slice(8))}} from '/assets/play/renderer.js';`;}}],
 treeshake:true
});
await bundle.write({dir:resolve(here,'../assets'),entryFileNames:'runtime.min.js',chunkFileNames:'chunks/[name]-[hash].js',format:'es',minify:true});
