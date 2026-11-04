"""Run under flock .tmp/gpu.lock; wait until Linux and Windows each have 8 GiB available."""
import re
import subprocess
import sys
import time
from pathlib import Path

while True:
    linux = int(re.search(r'MemAvailable:\s+(\d+)', Path('/proc/meminfo').read_text())[1])
    windows = int(subprocess.check_output(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
        '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'], text=True).strip())
    if min(linux, windows) >= 8 * 1024 * 1024:
        break
    print('Waiting for 8 GiB free on both hosts', flush=True)
    time.sleep(10)
raise SystemExit(subprocess.call(sys.argv[1:]))
