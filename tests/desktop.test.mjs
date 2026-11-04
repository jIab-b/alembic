import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {launchOptions,sshArgv,viewerPermission}=createRequire(import.meta.url)('../desktop/connection.cjs');
const url='http://127.0.0.1:5429/#'+new URLSearchParams({node:'http://127.0.0.1:5429',token:'test-token',workspace:'castle',vm:'old',preview:'http://127.0.0.1:5430'});
test('desktop layouts share the same viewer URL and SSH forwards both isolated origins',()=>{
  const full=launchOptions(['--url',url]),mini=launchOptions(['--url',url,'--minimal','--ssh','user@host','--local-port','6400','--preview-local-port','6401']);
  assert.equal(launchOptions(['--connect',url]).url,full.url);assert.equal(new URL(full.url).searchParams.has('layout'),false);assert.equal(new URL(mini.url).searchParams.get('layout'),'minimal');
  assert.deepEqual(mini.forwards,[{local:6400,remote:5429},{local:6401,remote:5430}]);
  const params=new URLSearchParams(new URL(mini.url).hash.slice(1));assert.equal(params.get('node'),'http://127.0.0.1:6400');assert.equal(params.get('preview'),'http://127.0.0.1:6401');assert.equal(params.get('token'),'test-token');
  const argv=sshArgv('user@host',mini.forwards);assert.ok(argv.includes('127.0.0.1:6400:127.0.0.1:5429'));assert.deepEqual(argv.slice(-2),['--','user@host']);
  const saved={url:'http://127.0.0.1:5429/',preview:'http://127.0.0.1:5430',ssh:'host','local-port':'6400','preview-local-port':'6401'};
  const resumed=launchOptions([],saved);assert.equal(new URL(resumed.url).hash,'');assert.deepEqual(resumed.forwards,mini.forwards);
  assert.equal(launchOptions(['--direct'],saved).forwards.length,0);
});
test('desktop rejects non-loopback endpoints, argument injection and invalid forward ports',()=>{
  for(const args of [['--url','https://example.com'],['--url',url,'--ssh','-oProxyCommand=bad'],['--url',url,'--ssh','host; cmd'],['--url',url,'--local-port','0'],['--url',url,'--local-port','6400x'],['--url',url,'--unknown'],['--url']])assert.throws(()=>launchOptions(args));
  assert.throws(()=>launchOptions(['--url',url,'--ssh','host','--local-port','6400','--preview-local-port','6400']),/different local ports/);
});


test('desktop allows game mouse capture and controller clipboard without granting native access to previews',()=>{
  const controller='http://127.0.0.1:6400',preview='http://127.0.0.1:6401';
  assert.equal(viewerPermission('pointerLock',preview+'/app/scene',controller,preview),true);
  assert.equal(viewerPermission('fullscreen',preview,controller,preview),true);
  assert.equal(viewerPermission('clipboard-read',controller,controller,preview),true);
  for(const [permission,origin] of [['clipboard-read',preview],['media',controller],['fileSystem',preview],['pointerLock','https://outside.test']])assert.equal(viewerPermission(permission,origin,controller,preview),false);
});
