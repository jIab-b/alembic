import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve, join} from 'node:path';
import {playwright,chromiumPath} from '../backend/deps.mjs';

// A private display belongs to this browser and is stopped when it disconnects.
export async function launchGpuBrowser({webgpu = false} = {}) {
  if(!process.env.TMPDIR)throw Error('TMPDIR is required');
  let temp=resolve(process.env.TMPDIR);
  if(temp.startsWith(process.cwd()+'/'))temp='/proc/self/cwd/'+temp.slice(process.cwd().length+1);
  const {chromium} = playwright();
  // WebGPU compatibility uses headless EGL, keeping the existing headed default intact.
  if (webgpu) {
    const env = {...process.env, TMPDIR: temp, XDG_CACHE_HOME:join(temp,'cache'), GALLIUM_DRIVER:'d3d12',
      MESA_D3D12_DEFAULT_ADAPTER_NAME:process.env.MESA_D3D12_DEFAULT_ADAPTER_NAME||'', LD_LIBRARY_PATH:
        ['/usr/lib/wsl/lib',process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')};
    delete env.DISPLAY; delete env.WAYLAND_DISPLAY; delete env.LIBGL_ALWAYS_SOFTWARE;
    const browser = await chromium.launch({executablePath:chromiumPath(),
      headless:true, env, ignoreDefaultArgs:['--enable-unsafe-swiftshader'],
      args:['--no-sandbox','--disable-gpu-sandbox','--disable-dev-shm-usage','--mute-audio','--enable-gpu',
        '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=gl-egl','--enable-unsafe-webgpu',
          '--use-webgpu-adapter=opengles']});
    try {
      const cdp = await browser.newBrowserCDPSession();
      const {gpu} = await cdp.send('SystemInfo.getInfo');
      await cdp.detach();
      const renderer = gpu.auxAttributes?.glRenderer || gpu.devices?.map(device => device.deviceString).join(' ');
      if (!gpu.featureStatus?.webgpu?.startsWith('enabled') || (!renderer ||
        /swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i.test(renderer)))
        throw new Error(`WebGPU compatibility route requires a hardware renderer; got ${JSON.stringify({renderer,
          webgpu:gpu.featureStatus?.webgpu})}`);
    } catch (error) { await browser.close(); throw error; }
    return browser;
  }
  // Chromium's SingletonSocket has a short Unix-domain path limit.
  const runtime = await mkdtemp(join(temp, 'gpu-'));
  const auth=join(runtime,'authority'),cookie=randomBytes(16),authority=number=>Buffer.concat([Buffer.from([255,255]),
    ...['',number,'MIT-MAGIC-COOKIE-1',cookie].flatMap(value=>{const bytes=Buffer.isBuffer(value)?value:
      Buffer.from(value),size=Buffer.alloc(2);size.writeUInt16BE(bytes.length);return [size,bytes]})]);
  await writeFile(auth,authority(''),{mode:0o600});
  const display = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x720x24', '-nolisten', 'unix', '-listen',
    'tcp', '-nolock', '-auth',auth, '-noreset'], {stdio:['ignore','ignore','pipe','pipe']});
  let stderr = '';
  display.stderr.on('data', data => { stderr += data; });
  let browser;
  try {
    const number = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Private display startup timed out')), 15000);
      display.once('error', reject);
      display.once('exit', code => reject(new Error(`Xvfb exited ${code}: ${stderr}`)));
      display.stdio[3].once('data', data => { clearTimeout(timer); resolve(String(data).trim()); });
    });
    if (!/^\d+$/.test(number)) throw new Error('Invalid Xvfb display: ' + number);
    await writeFile(auth,authority(number),{mode:0o600});
    const env = {...process.env, TMPDIR: temp, DISPLAY: '127.0.0.1:' + number, XAUTHORITY:auth, XDG_RUNTIME_DIR:
      runtime, XDG_CACHE_HOME:join(temp,'cache'),
      PULSE_SERVER: 'unix:' + runtime + '/no-audio', GALLIUM_DRIVER:'d3d12',
      MESA_D3D12_DEFAULT_ADAPTER_NAME:process.env.MESA_D3D12_DEFAULT_ADAPTER_NAME||'', LD_LIBRARY_PATH:
        ['/usr/lib/wsl/lib',process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')};
    delete env.WAYLAND_DISPLAY; delete env.LIBGL_ALWAYS_SOFTWARE;
    browser = await chromium.launch({executablePath:chromiumPath(),
      headless:false, env, ignoreDefaultArgs:['--enable-unsafe-swiftshader'],
      args:['--no-sandbox','--disable-dev-shm-usage','--mute-audio','--enable-gpu','--ignore-gpu-blocklist',
        '--use-gl=angle','--use-angle=gl-egl','--ozone-platform=x11']});
    const close = browser.close.bind(browser);
    browser.close = async (...args) => { try { return await close(...args); } finally { display.kill();
      await rm(runtime,{recursive:true,force:true}); } };
    browser.once('disconnected', () => { display.kill(); rm(runtime,{recursive:true,force:true}).catch(()=>{}); });
    return browser;
  } catch (error) { display.kill(); await rm(runtime,{recursive:true,force:true}); throw error; }
}

export async function assertHardware(page) {
  const result = await page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    const adapter = await navigator.gpu?.requestAdapter({powerPreference: 'high-performance'});
    const info = adapter?.info;
    return {renderer, adapter: adapter ? {vendor: info?.vendor, architecture: info?.architecture,
      device: info?.device, description: info?.description,
      fallback: info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false} : null};
  });
  const software = /swiftshader|llvmpipe|lavapipe|software|basic render|\bwarp\b/i;
  if (result.renderer && software.test(result.renderer)) throw new Error(`Software WebGL renderer: ${result.renderer}`);
  if (result.adapter && (result.adapter.fallback ||
    software.test(Object.values(result.adapter).join(' '))))
    throw new Error(`Software WebGPU adapter: ${JSON.stringify(result.adapter)}`);
  if (!result.renderer && (!result.adapter ||
    !result.adapter.vendor))
    throw new Error('No verifiable hardware WebGL2 renderer or WebGPU adapter: ' + JSON.stringify(result));
  return result;
}
