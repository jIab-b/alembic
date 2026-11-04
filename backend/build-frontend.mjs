import {cp, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';

const repo = fileURLToPath(new URL('../', import.meta.url));

// Keep old hashed chunks for open tabs. Publish each file atomically, with the
// entry last, so a live reader cannot see a partial file or a missing new chunk.
export async function publishFrontend(staging, output) {
  await stat(join(staging, 'index.html'));
  async function publish(relative) {
    const target = join(output, relative), temporary = target + '.publish-' + randomUUID();
    if (relative !== 'index.html') {
      try {
        if ((await readFile(target)).equals(await readFile(join(staging, relative)))) return;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await mkdir(dirname(target), {recursive: true});
    try {
      await copyFile(join(staging, relative), temporary);
      await rename(temporary, target);
    } finally { await rm(temporary, {force: true}); }
  }
  async function assets(relative = '') {
    for (const item of await readdir(join(staging, relative), {withFileTypes: true})) {
      const path = join(relative, item.name);
      if (item.isDirectory()) await assets(path);
      else if (path !== 'index.html') await publish(path);
    }
  }
  await assets();
  await publish('index.html');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), outputFlag = args.indexOf('--outDir');
  const output = outputFlag < 0 ? join(repo, 'frontend/dist') : resolve(args.splice(outputFlag, 2)[1]);
  const temporaryRoot = process.env.TMPDIR || join(repo, '.tmp');
  await mkdir(temporaryRoot, {recursive: true});
  const temporary = await mkdtemp(join(temporaryRoot, 'frontend-build-'));
  try {
    const staging = join(temporary, 'dist'), publicAssets = join(temporary, 'public');
    await mkdir(publicAssets);
    await cp(join(repo, 'frontend/public/assets'), join(publicAssets, 'assets'), {recursive: true});
    const status = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [join(dirname(createRequire(new URL('../frontend/package.json',
        import.meta.url)).resolve('vite/package.json')), 'bin/vite.js'),
        'build', ...args, '--outDir', staging, '--emptyOutDir'], {
        cwd: join(repo, 'frontend'), stdio: 'inherit',
        env: {...process.env, TMPDIR: temporary, AL_PUBLIC_DIR: publicAssets, NODE_COMPILE_CACHE: join(temporary,
          'node-cache')}
      });
      child.once('error', reject);
      child.once('exit', code => done(code ?? 1));
    });
    if (status) process.exitCode = status;
    else {
      const assets = await readdir(join(staging, 'assets'), {recursive: true});
      const worker = join(staging, 'assets/preview-sw.js');
      await writeFile(worker, (await readFile(worker, 'utf8'))
        .replace('/* bundled assets */ []', JSON.stringify(assets)));
      await publishFrontend(staging, output);
    }
  } finally { await rm(temporary, {recursive: true, force: true}); }
}
