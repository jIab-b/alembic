import {createRequire} from 'node:module';
import {mkdtemp, rm} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';
export async function windowsBrowser({profile, viewport = {width: 1400, height: 860}} = {}) {
  if (process.platform !== 'win32' || !process.env.TEMP) throw Error('Native Windows is required');
  profile ||= await mkdtemp(join(process.env.TEMP, 'alembic-ui-'));
  if (!/^alembic-ui-[\w-]+$/.test(relative(process.env.TEMP, resolve(profile))))
    throw Error('Profile must be directly beneath Windows TEMP');
  const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
  let context;
  const dispose = async () => {
    await context?.close(); await rm(profile, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
  };
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, viewport,
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
      args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio']
    });
    return {context, dispose};
  } catch (error) { await dispose(); throw error; }
}
