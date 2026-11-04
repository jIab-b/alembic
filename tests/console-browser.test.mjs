// Headless shared frontend against mock HTTP and a controllable mock WebSocket.
import test from 'node:test';
import assert from 'node:assert/strict';
import {windowsBrowser} from './windows-browser.mjs';
import {mockNode} from './mock-node.mjs';
import {mockHttp} from './mock-http.mjs';

async function fixture() {
  const node = mockNode();
  node.live.set('.alembic/tree.txt', Buffer.from(JSON.stringify({version:1,hidden:['internal.txt']})));
  node.live.set('internal.txt', Buffer.from('Internal'));
  node.live.set('.secret', Buffer.from('Private'));

  return mockHttp(node);
}

test('agent pane keeps installed commands, project prompt and direct collapse in one sandbox PTY', {timeout:15000}, async t => {
  const server=await fixture();let browser;
  try{
    browser=await windowsBrowser({viewport:{width:1450,height:900}});
    const page=await browser.context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      class MockSocket {static OPEN=1;readyState=0;onopen=null;onmessage=null;onerror=null;onclose=null;sent=[];
        constructor(){window.shells.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.({});this.onmessage?.({data:'sandbox$ '})},20)}
        addEventListener(){}send(value){this.sent.push(value);if(value.includes('ALEMBIC_PROJECT_NAME='))setTimeout(()=>this.onmessage?.({data:'\x1b[2J\x1b[HSupported agents:\r\ncodex\r\n\r\ntest $ '}),0)}close(){this.readyState=3;this.onclose?.({})}}
      window.shells=[];window.WebSocket=MockSocket;
    });
    await page.goto(server.origin+'/#'+new URLSearchParams({node:server.origin,token:'test-token',workspace:'w1',vm:'v1',agents:'codex'}));await page.evaluate(()=>window.__alembic.ready());
    await page.waitForFunction(()=>window.shells.length===1&&window.shells[0].readyState===1);
    assert.equal(await page.getByRole('combobox',{name:'Agent provider'}).count(),0);
    assert.equal(await page.getByRole('textbox',{name:'Message the agent'}).count(),0);
    assert.equal(await page.locator('.native-agent-terminal .controls').count(),0);
    await page.locator('.native-agent-terminal').getByText('Supported agents:',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Agent connection',exact:true}).getAttribute('title'),'Not connected');
    assert.equal((await page.getByRole('button',{name:'Collapse agent',exact:true}).innerText()).trim(),'‹');
    const input=page.locator('.native-agent-terminal .xterm-helper-textarea');await input.focus();
    await page.keyboard.type('ls');await page.keyboard.press('Enter');await page.keyboard.type('cd ..');await page.keyboard.press('Enter');await page.keyboard.type('codex --help');await page.keyboard.press('Enter');await page.keyboard.press('Tab');await page.keyboard.press('Escape');await page.keyboard.press('Control+c');
    const sent=await page.evaluate(()=>window.shells[0].sent);
    assert.ok(sent.some(s=>s.startsWith('\0{"resize":')));assert.ok(sent.join('').includes('ls\rcd ..\rcodex --help\r\t\x1b\x03'));
    await page.getByRole('button',{name:'Agent connection',exact:true}).click();
    await page.locator('.help-content:popover-open').waitFor();
    await page.getByText('No agents connected',{exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'note.txt',exact:true}).click();assert.equal(await page.evaluate(()=>window.shells.length),1);
    await page.getByRole('button',{name:'Collapse agent',exact:true}).click();await page.getByRole('button',{name:'Open agent',exact:true}).click();assert.equal(await page.evaluate(()=>window.shells.length),1);
    assert.equal(server.node.calls.filter(c=>c.path.endsWith('/shell/ticket')).length,1);
    assert.equal(server.node.calls.filter(c=>c.path.includes('/native-codex')||c.path.endsWith('/launch')).length,0);assert.deepEqual(errors,[]);
  }finally{await browser?.dispose();await server.close()}
});
