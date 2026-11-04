import assert from 'node:assert/strict';
import {test} from 'node:test';
import {frontendModules} from './frontend-modules.mjs';
const {replay:{createReplay}} = await frontendModules(['replay']);
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };

test('a seek awaiting completion cannot start playback on a replacement asset', async () => {
  const waiting = deferred(), errors = [], replay = createReplay(e => errors.push(e));
  let newPlays = 0;
  replay.attach({duration: 2, seek: time => time === 1 ? waiting.promise : undefined});
  const playing = replay.play(1);
  replay.attach({duration: 3, seek() {}, play: async () => { newPlays++; }});
  waiting.resolve(); await playing;
  assert.equal(newPlays, 0); assert.equal(replay.playing, false); assert.deepEqual(errors, []);
});

test('an old play rejection cannot pause or report failure on the replacement asset', async () => {
  const waiting = deferred(), errors = [], replay = createReplay(e => errors.push(e));
  let newPauses = 0;
  replay.attach({duration: 2, seek() {}, play: () => waiting.promise});
  const playing = replay.play();
  replay.attach({duration: 3, seek() {}, play: async () => {}, pause() { newPauses++; }});
  await replay.play(); const before = newPauses;
  waiting.reject(new Error('old asset closed')); await playing;
  assert.equal(newPauses, before); assert.equal(replay.playing, true); assert.deepEqual(errors, []);
});

test('a capture waiting on an old seek never captures the replacement asset', async () => {
  const waiting = deferred(), replay = createReplay(assert.fail);
  let newCaptures = 0;
  replay.attach({duration: 2, seek: time => time === 1 ? waiting.promise : undefined});
  void replay.seek(1); const capture = replay.capture();
  replay.attach({duration: 3, seek() {}, capture: async () => { newCaptures++; return new Uint8Array([1]); }});
  waiting.resolve(); assert.equal(await capture, null); assert.equal(newCaptures, 0);
});

for (const fails of [false,true]) test(`a stale async crop ${fails ? 'failure' : 'result'} is discarded`,async()=>{
  const waiting=deferred(), started=deferred(), errors=[], replay=createReplay(e=>errors.push(e));
  replay.attach({duration:2,seek(){},capture:()=>{started.resolve();return waiting.promise;}});
  const capture=replay.capture();
  await started.promise;
  replay.attach({duration:3,seek(){}});
  if(fails) waiting.reject(new Error('old crop failed'));
  else waiting.resolve(new Uint8Array([1]));
  assert.equal(await capture,null);
  assert.deepEqual(errors,[]);
});

test('static sources can capture without exposing playback controls', async () => {
  const replay = createReplay(assert.fail), png = new Uint8Array([137,80,78,71]);
  replay.attach({duration: 0, seek() {}, capture: async () => png});
  assert.equal(replay.available, false); assert.deepEqual(await replay.capture(), png);
});

test('a deferred old seek rejection cannot report an error on its replacement', async () => {
  const waiting = deferred(), errors = [], replay = createReplay(e => errors.push(e));
  replay.attach({duration: 2, seek: time => time === 1 ? waiting.promise : undefined});
  const seeking = replay.seek(1);
  replay.attach({duration: 3, seek() {}});
  waiting.reject(new Error('old seek failed')); await seeking;
  assert.deepEqual(errors, []);
});

test('an unbounded source arms without playing and counts beyond finite lengths', async () => {
  const replay=createReplay(assert.fail);let time=0,plays=0,tick;
  const previous=requestAnimationFrame;globalThis.requestAnimationFrame=callback=>{tick=callback;return 1};
  try {replay.attach({duration:Infinity,currentTime:()=>time,seek(){},play:async()=>{plays++}});
    assert.equal(replay.available,true);assert.equal(replay.time,0);assert.equal(plays,0);
    await replay.play();time=4001;tick(performance.now());assert.equal(replay.time,4001);assert.equal(replay.playing,true);
    replay.reset();assert.equal(replay.available,false);assert.equal(replay.time,0);assert.equal(plays,1);
  } finally {globalThis.requestAnimationFrame=previous}
});
