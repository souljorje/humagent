import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { ensure, Failure, type Target } from './protocol.js';
import type { Store } from './store.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const LIMIT = 8 * 1024 * 1024;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
};
export const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
export async function targetOf(
  value: string,
  network = false,
): Promise<Target> {
  if (/^https?:/i.test(value)) {
    const url = new URL(value);
    ensure(
      url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname) &&
        !url.username &&
        !url.password,
      'Only explicit HTTP localhost/127.0.0.1 targets are supported',
    );
    url.hostname = '127.0.0.1';
    url.hash = '';
    return { kind: 'url', value: url.href, network: true };
  }
  const canonical = await fs.realpath(path.resolve(value));
  ensure(
    /\.html?$/i.test(canonical),
    'v0.1 opens HTML files or localhost apps. Markdown rendering is not implemented.',
  );
  return {
    kind: 'file',
    value: canonical,
    root: path.dirname(canonical),
    network,
  };
}
export async function safeFile(root: string, requestPath: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    throw new Failure(400, 'INVALID_PATH', 'Invalid URL encoding');
  }
  ensure(
    !decoded.includes('\\') &&
      !decoded.includes('\0') &&
      !decoded.split('/').some((part) => part.startsWith('.')),
    'Hidden files and traversal are not shared',
    'FORBIDDEN',
    403,
  );
  const canonical = await fs.realpath(path.resolve(root, `.${decoded}`));
  const relative = path.relative(root, canonical);
  ensure(
    relative !== '' &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !relative.split(path.sep).some((part) => part.startsWith('.')),
    'Path escapes the shared directory',
    'FORBIDDEN',
    403,
  );
  ensure(
    MIME[path.extname(canonical).toLowerCase()],
    'This file type is not shared',
    'FORBIDDEN',
    403,
  );
  ensure((await fs.stat(canonical)).isFile(), 'Not a file', 'FORBIDDEN', 403);
  return canonical;
}
async function collect(stream: IncomingMessage) {
  const parts: Buffer[] = [];
  let count = 0;
  for await (const part of stream) {
    const buf = Buffer.from(part);
    count += buf.length;
    ensure(count <= LIMIT, 'Upstream document exceeds 8 MiB', 'TOO_LARGE', 413);
    parts.push(buf);
  }
  const bytes = Buffer.concat(parts);
  switch (stream.headers['content-encoding']) {
    case 'gzip':
      return gunzipSync(bytes, { maxOutputLength: LIMIT });
    case 'deflate':
      return inflateSync(bytes, { maxOutputLength: LIMIT });
    case 'br':
      return brotliDecompressSync(bytes, { maxOutputLength: LIMIT });
    default:
      return bytes;
  }
}
async function fetchDocument(url: URL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      {
        headers: { accept: 'text/html', 'accept-encoding': 'identity' },
        timeout: 15000,
      },
      async (res) => {
        try {
          ensure(
            res.statusCode === 200,
            `Local app returned ${res.statusCode}. Open its final route explicitly.`,
            'UPSTREAM',
            502,
          );
          ensure(
            res.headers['content-type']?.includes('text/html'),
            'Target did not return HTML',
            'UPSTREAM',
            502,
          );
          resolve(await collect(res));
        } catch (e) {
          res.destroy();
          reject(e);
        }
      },
    );
    req.on('timeout', () =>
      req.destroy(new Error('Local application timed out')),
    );
    req.on('error', reject);
  });
}
export async function sourceRevision(target: Target) {
  return digest(
    target.kind === 'file'
      ? await fs.readFile(target.value)
      : await fetchDocument(new URL(target.value)),
  );
}
function inject(html: string, bootstrap: object) {
  // Insert after the initial doctype, not a regex-matched </body> inside a script.
  const prefix = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  const encoded = JSON.stringify(bootstrap).replaceAll('<', '\\u003c');
  return `${prefix}<script>window.__HUMAGENT__=${encoded}</script><script type="module" src="/__humagent/sdk.js"></script>${html.slice(prefix.length)}`;
}
export interface Surface {
  origin: string;
  frameUrl: string;
  channel: string;
  checkRevision: () => Promise<string>;
  close: () => Promise<void>;
}
export async function startSurface(
  store: Store,
  id: string,
  parentOrigin: string,
): Promise<Surface> {
  const target = store.get(id).target;
  const channel = randomBytes(24).toString('hex');
  let origin = '';
  let currentPath =
    store.get(id).surfacePath ??
    (target.kind === 'file'
      ? `/${encodeURIComponent(path.basename(target.value))}`
      : new URL(target.value).pathname + new URL(target.value).search);
  const upstreamOrigin =
    target.kind === 'url' ? new URL(target.value).origin : '';
  async function revision() {
    if (target.kind === 'url') return store.get(id).revision;
    const bytes = await fs.readFile(
      await safeFile(target.root!, currentPath.split('?')[0]!),
    );
    const hash = digest(bytes);
    store.setRevision(id, hash);
    return hash;
  }
  function decorated(bytes: Buffer, route: string) {
    currentPath = route;
    const hash = digest(bytes);
    store.setRevision(id, hash, currentPath);
    return inject(bytes.toString('utf8'), {
      protocol: 1,
      session: id,
      channel,
      parentOrigin,
      revision: hash,
      sourceUrl:
        target.kind === 'file'
          ? path.resolve(
              target.root!,
              '.' + decodeURIComponent(route.split('?')[0]!),
            )
          : new URL(route, upstreamOrigin).href,
    });
  }
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer(async (req, res) => {
    try {
      ensure(
        req.headers.host === new URL(origin).host,
        'Invalid surface host',
        'FORBIDDEN',
        403,
      );
      ensure(
        typeof req.url === 'string' &&
          req.url.startsWith('/') &&
          !req.url.startsWith('//'),
        'Invalid request path',
      );
      const rawPath = req.url.split('?')[0]!;
      const url = new URL(req.url, origin);
      const requestOrigin = req.headers.origin;
      if (requestOrigin && !['GET', 'HEAD'].includes(req.method ?? 'GET'))
        ensure(requestOrigin === origin, 'Foreign origin', 'FORBIDDEN', 403);
      if (rawPath.startsWith('/__humagent/')) {
        const name = rawPath.slice('/__humagent/'.length);
        ensure(
          [
            'sdk.js',
            'json.js',
            'targets.js',
            'selection/anchors.js',
          ].includes(name),
          'Not found',
          'NOT_FOUND',
          404,
        );
        res.writeHead(200, {
          'content-type': 'text/javascript',
          'cache-control': 'no-store',
        });
        return res.end(await fs.readFile(path.join(WEB, name)));
      }
      if (target.kind === 'file') {
        ensure(
          ['GET', 'HEAD'].includes(req.method ?? ''),
          'File interfaces are read-only',
          'READ_ONLY',
          405,
        );
        const file = await safeFile(
          target.root!,
          rawPath === '/' ? `/${path.basename(target.value)}` : rawPath,
        );
        const bytes = await fs.readFile(file);
        ensure(bytes.length <= LIMIT, 'Asset exceeds 8 MiB', 'TOO_LARGE', 413);
        const html = /\.html?$/i.test(file);
        const net = target.network ? ' http: https: ws: wss:' : '';
        const policy = `default-src 'none'; script-src 'self' 'unsafe-inline'${net}; style-src 'self' 'unsafe-inline'${net}; img-src 'self' data: blob:${net}; font-src 'self' data:${net}; connect-src ${target.network ? "'self'" + net : "'none'"}; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors ${parentOrigin}`;
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()]!,
          'content-security-policy': policy,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        });
        return res.end(
          req.method === 'HEAD'
            ? undefined
            : html
              ? decorated(
                  bytes,
                  rawPath === '/' ? `/${path.basename(target.value)}` : req.url,
                )
              : bytes,
        );
      }
      // Fixed destination only; never accept a URL parameter or follow redirects.
      const destination = new URL(url.pathname + url.search, upstreamOrigin);
      const headers = {
        ...req.headers,
        host: destination.host,
        'accept-encoding': 'identity',
      };
      delete headers.cookie; // No implicit browser credentials forwarded into a development app.
      if (headers.origin) headers.origin = upstreamOrigin;
      delete headers.connection;
      const upstream = http.request(
        destination,
        { method: req.method, headers, timeout: 15000 },
        async (response) => {
          try {
            const out = { ...response.headers };
            for (const h of [
              'connection',
              'transfer-encoding',
              'content-length',
              'content-encoding',
              'set-cookie',
            ])
              delete out[h];
            if (out.location) {
              const redirect = new URL(out.location, destination);
              ensure(
                redirect.origin === upstreamOrigin,
                'Redirect leaves configured local application',
                'UPSTREAM_REDIRECT',
                502,
              );
              out.location =
                origin + redirect.pathname + redirect.search + redirect.hash;
            }
            if (
              response.headers['content-type']?.includes('text/html') &&
              response.statusCode === 200
            ) {
              const body = await collect(response);
              out['cache-control'] = 'no-store';
              res.writeHead(200, out);
              res.end(decorated(body, url.pathname + url.search));
            } else {
              // Identity was requested; preserve content-encoding for non-HTML streams.
              if (response.headers['content-encoding'])
                out['content-encoding'] = response.headers['content-encoding'];
              res.writeHead(response.statusCode ?? 502, out);
              response.pipe(res);
            }
          } catch (error) {
            response.destroy();
            fail(res, error);
          }
        },
      );
      upstream.on('timeout', () =>
        upstream.destroy(new Error('Local application timed out')),
      );
      upstream.on('error', (error) => fail(res, error));
      req.pipe(upstream);
      res.on('close', () => {
        if (!res.writableEnded) upstream.destroy();
      });
    } catch (error) {
      fail(res, error);
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  // Forward local dev-server WebSockets (including common HMR) without a WS library.
  server.on('upgrade', (req, socket, head) => {
    if (
      target.kind !== 'url' ||
      req.headers.host !== new URL(origin).host ||
      req.headers.origin !== origin ||
      !req.url?.startsWith('/') ||
      req.url.startsWith('//')
    ) {
      socket.destroy();
      return;
    }
    const destination = new URL(req.url, upstreamOrigin);
    const headers = {
      ...req.headers,
      host: destination.host,
      origin: upstreamOrigin,
    };
    delete headers.cookie;
    const upstream = http.request(destination, { headers, timeout: 10000 });
    upstream.on('upgrade', (response, peer, initial) => {
      socket.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`,
      );
      for (let i = 0; i < response.rawHeaders.length; i += 2)
        socket.write(
          `${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`,
        );
      socket.write('\r\n');
      if (initial.length) socket.write(initial);
      if (head.length) peer.write(head);
      peer.pipe(socket);
      socket.pipe(peer);
      peer.on('error', () => socket.destroy());
      socket.on('error', () => peer.destroy());
      socket.on('close', () => peer.destroy());
      peer.on('close', () => socket.destroy());
    });
    upstream.on('response', () => socket.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.on('timeout', () => upstream.destroy());
    upstream.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const watcher =
    target.kind === 'file'
      ? setInterval(() => {
          void revision().catch(() => {});
        }, 2000)
      : undefined;
  watcher?.unref();
  return {
    origin,
    channel,
    get frameUrl() {
      return origin + currentPath;
    },
    checkRevision: revision,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(watcher);
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
function fail(res: ServerResponse, error: unknown) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(error instanceof Failure ? error.status : 502, {
    'content-type': 'text/plain',
    'x-content-type-options': 'nosniff',
  });
  res.end(
    error instanceof Error ? error.message : 'Interface could not be served',
  );
}
