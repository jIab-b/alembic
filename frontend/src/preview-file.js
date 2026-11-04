// Large preview assets use the Vault's existing CLI transport. The host executes
// only its trusted shell client; Python and every file read run inside the VM.
export const PREVIEW_FILE_LIMIT = 128 * 1024 * 1024;
const pending = new WeakMap();
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export const previewReader = `import base64, hashlib, os, stat, sys
path, nonce, expected = sys.argv[1:]
expected = int(expected)
prefix = nonce + ':'
fds = []
try:
    parts = path.split('/')
    if any(not p or p.startswith('.') or '\\\\' in p or '\\0' in p for p in parts):
        raise ValueError('Invalid preview path')
    parent = os.open('.', os.O_RDONLY | os.O_DIRECTORY)
    fds.append(parent)
    for part in parts[:-1]:
        parent = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        fds.append(parent)
    fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    fds.append(fd)
    before = os.fstat(fd)
    signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if not stat.S_ISREG(before.st_mode) or before.st_size != expected or not 0 <= expected <= ${PREVIEW_FILE_LIMIT}:
        raise ValueError('Preview file size changed or exceeds 128 MiB')
    print(prefix + 'start:' + str(expected), flush=True)
    digest, total = hashlib.sha256(), 0
    while True:
        data = os.read(fd, min(49152, expected - total + 1))
        if not data:
            break
        total += len(data)
        if total > expected:
            raise ValueError('Preview file changed while reading')
        digest.update(data)
        print(prefix + 'data:' + base64.b64encode(data).decode('ascii'), flush=True)
    after = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
    if total != expected or signature(before) != signature(os.fstat(fd)) or signature(before) != signature(after):
        raise ValueError('Preview file changed while reading')
    print(prefix + 'done:' + digest.hexdigest(), flush=True)
except Exception as error:
    print(prefix + 'error:' + str(error), flush=True)
    sys.exit(1)
finally:
    for fd in reversed(fds):
        os.close(fd)
`;

export function readPreviewFile(client, path, size) {
  if (typeof path !== 'string' || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part.startsWith('.')))
    return Promise.reject(new Error('Invalid preview path'));
  if (!Number.isSafeInteger(size) || size < 0 || size > PREVIEW_FILE_LIMIT)
    return Promise.reject(new Error('Preview file exceeds 128 MiB'));
  let files = pending.get(client);
  if (!files) pending.set(client, files = new Map());
  const key = JSON.stringify([path, size]);
  if (!files.has(key)) {
    const result = read(client, path, size).finally(() => files.delete(key));
    files.set(key, result);
  }
  return files.get(key);
}
async function read(client, path, size) {
  client.scope.signal.throwIfAborted();
  const {executable} = await client.json(client.v('shell-client'), {});
  if (typeof executable !== 'string' || !executable.startsWith('/') || executable.includes('\0')) throw new Error('VM shell unavailable');
  const nonce = crypto.randomUUID(), prefix = nonce + ':';
  const command = ['python3', '-I', '-c', previewReader, path, nonce, String(size)].map(quote).join(' ');
  const socket = await client.call([executable, command]);
  return new Promise((resolve, reject) => {
    let buffer = '', offset = 0, started = false, finished = false, verifying = false;
    const bytes = new Uint8Array(size), decoder = new TextDecoder();
    const finish = (error, result) => {
      if (finished) return;
      finished = true; clearTimeout(timer); client.scope.signal.removeEventListener('abort', abort);
      socket.onmessage = socket.onclose = socket.onerror = null; socket.close();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new Error('Preview read cancelled'));
    const timer = setTimeout(() => finish(new Error('Preview file timed out')), 120000);
    client.scope.signal.addEventListener('abort', abort, {once:true});
    socket.onerror = () => finish(new Error('Preview VM connection failed'));
    socket.onclose = () => { if (!verifying) finish(new Error('Preview VM read ended before completion')); };
    socket.onmessage = ({data}) => {
      if (finished || verifying) return;
      try {
        buffer += typeof data === 'string' ? data : decoder.decode(data, {stream:true});
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0,end).replace(/\r$/, ''); buffer = buffer.slice(end+1);
          if (!line.startsWith(prefix)) continue;
          const record = line.slice(prefix.length), split = record.indexOf(':'), kind = record.slice(0,split), value = record.slice(split+1);
          if (kind === 'error') throw new Error(value || 'Preview VM read failed');
          if (kind === 'start') {
            if (started || value !== String(size)) throw new Error('Invalid preview size');
            started = true;
          } else if (kind === 'data') {
            if (!started || value.length > 65536 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid preview chunk');
            const decoded = atob(value);
            if (offset + decoded.length > size) throw new Error('Preview file exceeded its declared size');
            for (let i=0;i<decoded.length;i++) bytes[offset++] = decoded.charCodeAt(i);
          } else if (kind === 'done') {
            if (!started || offset !== size || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Incomplete preview file');
            verifying = true;
            crypto.subtle.digest('SHA-256', bytes).then(hash => {
              const actual = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,'0')).join('');
              if (actual !== value) throw new Error('Preview file checksum mismatch');
              finish(null, bytes);
            }).catch(error => finish(error));
            break;
          } else throw new Error('Invalid preview protocol');
        }
        if (buffer.length > 131072) throw new Error('Preview VM output exceeded its limit');
      } catch (error) { finish(error); }
    };
    if (client.scope.signal.aborted) abort();
  });
}
