import {createRequire} from 'node:module';
import {mkdir, mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {pathToFileURL, fileURLToPath} from 'node:url';
const temporary = process.env.TMPDIR || fileURLToPath(new URL('../.tmp', import.meta.url));
await mkdir(temporary,{recursive:true});
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript'), {compileModule} = require('svelte/compiler');
export async function frontendModules(names = ['folder','history','backends','workspace']) {
  const directory = await mkdtemp(temporary+'/.ui-test-');
  try {
    for (const [name, path] of Object.entries({folder:'folder.ts',history:'history.ts',backends:'terminal/backends.ts',replay:'replay.svelte.ts',workspace:'workspace.svelte.ts'})) {
      let source = await readFile(new URL('../frontend/src/'+path, import.meta.url), 'utf8');
      if (name === 'workspace') {
        source = source.replace("import {onMount} from 'svelte';", 'const onMount = callback => globalThis.__uiMounts.push(callback);')
          .replaceAll('import.meta.env.BASE_URL', "'/'").replace('await loadViewer()', 'globalThis.__uiViewer');
      }
      source = source.replace(/(['"])\.\/([^'"]+)\1/g, (_match, _quote, path) => {
        const generated = {folder:'folder', history:'history', 'terminal/backends':'backends', 'replay.svelte':'replay'};
        return JSON.stringify(generated[path] ? './'+generated[path]+'.mjs'
          : new URL('../frontend/src/'+(path === 'contract/render' ? 'contract/surface.js' : path),import.meta.url).href);
      });
      let code = ts.transpile(source, {target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext});
      if (name === 'workspace' || name === 'replay') code = compileModule(code, {filename:name+'.svelte.js',generate:'client'}).js.code;
      code = code.replaceAll('svelte/internal/client', pathToFileURL(require.resolve('svelte/internal/client')).href)
        .replaceAll("from 'svelte'", 'from '+JSON.stringify(pathToFileURL(require.resolve('svelte')).href));
      await writeFile(directory+'/'+name+'.mjs', code);
    }
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await import(pathToFileURL(directory+'/'+name+'.mjs'))])));
  } finally { await rm(directory,{recursive:true,force:true}); }
}
