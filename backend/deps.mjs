import {existsSync} from 'node:fs';
import {delimiter,join} from 'node:path';
import {createRequire} from 'node:module';
export function tool(relative,name) {
  const path=process.env.ALEMBIC_DEPS?join(process.env.ALEMBIC_DEPS,relative):
    (process.env.PATH||'').split(delimiter).map(dir=>join(dir,name)).find(existsSync);
  if(!path||!existsSync(path))throw Error(`Missing ${name}; install it on PATH or set ALEMBIC_DEPS`);
  return path;
}
export function playwright() {
  const name=process.env.PLAYWRIGHT_MODULE||(process.env.ALEMBIC_DEPS?
    join(process.env.ALEMBIC_DEPS,'browser-tools/node_modules/playwright'):'playwright');
  try{return createRequire(import.meta.url)(name)}
  catch{throw Error('Missing playwright; set PLAYWRIGHT_MODULE or ALEMBIC_DEPS, or install playwright')}
}
export const chromiumPath=()=>process.env.CHROMIUM_PATH||tool('chromium/chrome','chromium');
