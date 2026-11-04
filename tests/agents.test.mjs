import test from 'node:test';
import assert from 'node:assert/strict';
import {commandSession, mergeSession, sessionKey} from '../frontend/src/agents.js';
import {frontendModules} from './frontend-modules.mjs';
const {folder:{projectName}} = await frontendModules();

test('events preserve exact session identity, reject another VM and merge replays without regressing activity',()=>{
  const event={id:8370000000,kind:'agent.command',session:'exact-session',vm:'live',agent:'codex',pid:31,external:false,last_command:200};
  const own=commandSession(event,'live');
  assert.equal(sessionKey(own),'exact-session');assert.notEqual(own.id,event.id);
  assert.equal(commandSession(event,'other'),null);
  assert.equal(commandSession({...event,kind:'run.begin'},'live'),null);
  const external=commandSession({...event,session:null,external:true},'live');
  assert.equal(sessionKey(external),'pid:31');
  let rows=mergeSession([own],external);assert.equal(rows.length,2);
  rows=mergeSession(rows,{...own,last_command:100});assert.equal(rows.find(row=>row.id===own.id).last_command,200);
  rows=mergeSession(rows,{...own,last_command:300});assert.equal(rows.length,2);assert.equal(rows.at(-1).last_command,300);
});

test('unidentified SSH connections still activate the connector with distinct connection identities',()=>{
  const now=Date.now();
  const event={kind:'agent.command',vm:'live',agent:'ssh',external:true,attachable:false,last_command:now};
  const first=commandSession({...event,session:'ssh:30001:40000'},'live');
  const second=commandSession({...event,session:'ssh:30002:40000'},'live');
  const rows=mergeSession([first],second);
  assert.equal(rows.length,2);assert.notEqual(sessionKey(first),sessionKey(second));
});

test('project labels use folder names and disambiguate only colliding basenames',()=>{
  const a={id:'internal-a',name:'internal-alias',path:'/projects/test/'},b={id:'internal-b',path:'/work/test'},c={path:'/work/other'};
  assert.equal(projectName(a,[a,c]),'test');
  assert.equal(projectName(a,[a,b,c]),'projects/test');
  assert.equal(projectName(b,[a,b,c]),'work/test');
  assert.equal(projectName(c,[a,b,c]),'other');
});
