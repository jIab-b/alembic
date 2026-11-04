import {spawnSync} from 'node:child_process';
import {readdirSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
const base = process.env.TMPDIR || resolve('.tmp/tests');
mkdirSync(base, {recursive: true});
const temporary = mkdtempSync(join(base, 'cpu-'));
const env = {...process.env, TMPDIR: temporary, AL_HOME: join(temporary, 'home'), PYTHONDONTWRITEBYTECODE: '1'};
const tests = readdirSync('tests').filter(name => name.endsWith('.test.mjs') &&
  !['console-browser.test.mjs', 'web-interaction.test.mjs', 'frozen.test.mjs'].includes(name));
try {
  for (const [command, args] of [['node', ['--test', ...tests.map(name => 'tests/' + name)]],
    ['python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py']]]) {
    const result = spawnSync(command, args, {env, stdio: 'inherit'});
    if (result.status) process.exitCode = result.status;
  }
} finally { rmSync(temporary, {recursive: true, force: true}); }
