"""Private native display, owned child processes only; caches remain in TMPDIR."""
import os
from pathlib import Path
import select
import subprocess
import sys
import secrets
import struct

root = Path(os.environ['TMPDIR'])
env = dict(os.environ, XDG_DATA_HOME=str(root/'data'), XDG_CONFIG_HOME=str(root/'config'), XDG_CACHE_HOME=str(root/'cache'),
           GALLIUM_DRIVER='d3d12', LD_LIBRARY_PATH='/usr/lib/wsl/lib:'+os.environ.get('LD_LIBRARY_PATH',''))
env.pop('WAYLAND_DISPLAY', None)
env.pop('LIBGL_ALWAYS_SOFTWARE', None)
runtime=root/'native-runtime'; runtime.mkdir(exist_ok=True)
env['XDG_RUNTIME_DIR']=str(runtime)
auth=root/'native.xauth'; cookie=secrets.token_bytes(16)
def authority(number):
    return struct.pack('!H',65535)+b''.join(struct.pack('!H',len(v))+v for v in [b'',number.encode(),b'MIT-MAGIC-COOKIE-1',cookie])
auth.write_bytes(authority(''))
env['XAUTHORITY']=str(auth)
read, write = os.pipe()
display = subprocess.Popen(['Xvfb','-displayfd',str(write),'-screen','0','1280x720x24','-nolisten','unix','-listen','tcp','-nolock','-auth',str(auth)], pass_fds=(write,), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
os.close(write)
try:
    if not select.select([read],[],[],10)[0]: raise RuntimeError('Private display timed out')
    number=os.read(read,32).decode().strip()
    if not number.isdigit(): raise RuntimeError('Private Xvfb exited before opening its display')
    auth.write_bytes(authority(number))
    env['DISPLAY'] = '127.0.0.1:'+number
    driver=Path(os.environ['ALEMBIC_DEPS']).parent/'runtime/driver' if os.environ.get('ALEMBIC_DEPS') else None
    icd=os.environ.get('ALEMBIC_VULKAN_ICD') or (str(driver/'icd/dzn_icd.json') if driver else '')
    if icd and Path(icd).is_file() and Path(sys.argv[1]).name=='godot':
        env.update(VK_DRIVER_FILES=icd,VK_ICD_FILENAMES=icd,
            LD_LIBRARY_PATH=str(Path(icd).parent.parent/'lib')+':'+env['LD_LIBRARY_PATH'])
    subprocess.run(sys.argv[1:],env=env,check=True,timeout=95)
finally:
    os.close(read)
    display.terminate()
    display.wait(timeout=5)
