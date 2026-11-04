import test from 'node:test';
import assert from 'node:assert/strict';
import {animationNames,pack} from '../render/babylon/document.js';

test('child clip discovery uses actual GLB animation metadata without inventing clips',()=>{
  const bytes=pack({asset:{version:'2.0'},animations:[{name:'reload'},{name:'bolt_cycle'},{}]},null);
  assert.deepEqual(animationNames(bytes),['reload','bolt_cycle','Animation 3']);
  assert.deepEqual(animationNames(pack({asset:{version:'2.0'}},null)),[]);
});
test('clip discovery reports limits and invalid data instead of truncating',()=>{
  assert.throws(()=>animationNames(pack({asset:{version:'2.0'},animations:Array(129).fill({})},null)),/128 clips/);
  assert.throws(()=>animationNames(new TextEncoder().encode('not glTF')));
});
