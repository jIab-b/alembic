import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const baselines=(await readdir(new URL('./frozen/',import.meta.url))).filter(p=>p.endsWith('.json'));
test('every frozen frontend state replays in Windows Chrome',{skip:!process.env.ALEMBIC_FROZEN_WINDOWS},()=>{
 assert.ok(baselines.length,'Record at least one baseline with al freeze');
 const result=spawnSync('python3',['-B','tests/replay-frozen.py',...baselines],{encoding:'utf8',timeout:115000});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
