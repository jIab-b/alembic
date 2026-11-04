// Run with native Windows Node/Chrome; all requests use this in-memory fixture.
import {createRequire} from 'node:module';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE||'playwright');
const profile = await mkdtemp(join(process.env.TEMP, 'alembic-ui-capture-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true,
    ignoreDefaultArgs:['--enable-unsafe-swiftshader'], viewport:{width:800,height:600},
    args:['--no-first-run','--no-default-browser-check','--disable-extensions','--mute-audio']
  });
  const page = context.pages()[0];
  await page.route('http://capture.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({contentType:'text/html',body:`<!doctype html><style>
      body{margin:0}button{position:absolute;left:40px;top:30px;width:100px;height:80px;border:0;
      background:color-mix(in srgb,rgb(20,100,200) 100%,white);color:white}
      </style><button>IO</button><script src="/assets/play/app-tools.js"></script>`});
    const file = new URL('../frontend/dist' + path, import.meta.url);
    return route.fulfill({contentType:'text/javascript',body:await readFile(file)});
  });
  await page.goto('http://capture.test/');
  const result = await page.evaluate(async () => {
    const inspect = area => new Promise(resolve => {
      const id = String(Math.random());
      const listener = ({data}) => {
        if (data?.type === 'alembic.inspected' && data.id === id) {
          removeEventListener('message',listener); resolve(data);
        }
      };
      addEventListener('message',listener);
      postMessage({type:'alembic.inspect',id,area},'*');
    });
    const data = await inspect([.05,.05,.125,80/600]);
    const image = await createImageBitmap(new Blob([data.png],{type:'image/png'}));
    const canvas = document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx = canvas.getContext('2d');ctx.drawImage(image,0,0);
    const pixel = [...ctx.getImageData(5,5,1,1).data];
    window.frameStarts = 0;
    const live = document.createElement('iframe');
    live.srcdoc = '<script>parent.frameStarts++<\/script>';
    live.style.cssText='position:absolute;left:500px;top:300px;width:100px;height:100px';
    const loaded = new Promise(resolve=>live.onload=resolve);document.body.append(live);await loaded;
    await inspect([.05,.05,.125,80/600]);
    const startsAfterCapture = window.frameStarts;
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts';frame.srcdoc='<b>Private</b>';
    frame.style.cssText='position:absolute;left:200px;top:0;width:200px;height:200px';
    document.body.append(frame);await new Promise(resolve=>frame.onload=resolve);
    const blocked = await inspect([.25,0,.25,1/3]);
    return {width:image.width,height:image.height,pixel,objects:data.objects,
      startsAfterCapture,warning:data.warning,blockedWarning:blocked.warning,blockedObjects:blocked.objects.length};
  });
  assert.equal(result.startsAfterCapture,1,'Capture must never start another embedded app');
  assert.equal(result.width,100);assert.equal(result.height,80);
  assert.deepEqual(result.pixel,[20,100,200,255]);
  assert.ok(result.objects.some(object=>object.name.includes('IO')));
  assert.equal(result.warning,undefined);
  assert.match(result.blockedWarning,/inaccessible embedded frame/);
  assert.ok(result.blockedObjects>0);
  console.log('PASS: HTML inspection retains metadata, crops modern CSS pixels, and reports inaccessible frames');
} finally {
  await context?.close();await rm(profile,{recursive:true,force:true});
}
