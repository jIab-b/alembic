import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// Share HTTP plumbing; each caller still owns its route effects and assertions.
export async function mockHttp(node, handle = () => false) {
  const root = resolve(process.env.ALEMBIC_FRONTEND_DIST ||
    fileURLToPath(new URL('../frontend/dist/', import.meta.url)));
  let origin;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin), path = url.pathname;
      if (path.startsWith('/w/') || path === '/vms' || path.startsWith('/vms/') || path === '/workspaces') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        if (await handle(request, response, url, body)) return;
        if (path.endsWith('/events')) {
          response.writeHead(200, {'Content-Type':'text/event-stream'});
          response.write(': connected\n\n');
          return;
        }
        const result = await node.fetch(url.href, {method:request.method, headers:request.headers,
          ...(body.length ? {body} : {})});
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
      if (!file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(file);
      response.writeHead(200, {'Content-Type':{'.html':'text/html', '.js':'text/javascript',
        '.css':'text/css', '.json':'application/json'}[extname(file)] || 'application/octet-stream'}).end(bytes);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  return {origin, node, close:() => new Promise(done => {server.closeAllConnections(); server.close(done);})};
}
