import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('launcher opens the complete URL on Linux and WSL and prints it on failure', () => {
  const result = spawnSync('python3', ['-B', '-c', `
import contextlib, io
from unittest.mock import patch
import launcher
url = "http://127.0.0.1:1234/#node=http%3A%2F%2F127.0.0.1&token=test&workspace=w&vm=v&agents=codex"
with patch.dict(launcher.os.environ, {}, clear=True), patch.object(launcher.os, 'uname') as uname, patch.object(launcher.webbrowser, 'open') as browser, patch.object(launcher.subprocess, 'run') as run:
    uname.return_value.release = 'Linux'
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        launcher.open_browser(url)
    assert output.getvalue() == url + '\\n'
    browser.assert_called_once_with(url)
    run.assert_not_called()
    uname.return_value.release = 'microsoft-standard-WSL2'
    launcher.open_browser(url)
    assert run.call_args.args[0] == ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', "Start-Process '" + url + "'"]
    run.side_effect = OSError('unavailable')
    launcher.open_browser(url)
    uname.return_value.release = 'Linux'
    browser.side_effect = OSError('unavailable')
    launcher.open_browser(url)
`], {cwd: new URL('..', import.meta.url), encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
