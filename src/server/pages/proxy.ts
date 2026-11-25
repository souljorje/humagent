/** The proxy to a local app: requests and WebSocket upgrades. */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { ensure } from '../../shared/validate.js';
import type { Decorate } from './documents.js';
import { fail } from './failure.js';
import { collect } from './upstream.js';

export function proxyApplication(
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
  origin: string,
  upstreamOrigin: string,
  decorate?: Decorate,
) {
  // Fixed destination only; never accept a URL parameter or follow redirects.
  const destination = new URL(route, upstreamOrigin);
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
        const eventStream =
          response.headers['content-type']
            ?.split(';')[0]
            ?.trim()
            .toLowerCase() === 'text/event-stream';
        // Keep the initial timeout, but allow an established event stream to stay silent.
        if (eventStream) upstream.setTimeout(0);
        const out = { ...response.headers };
        for (const h of [
          'connection',
          'transfer-encoding',
          'content-length',
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
          decorate &&
          response.headers['content-type']?.includes('text/html') &&
          response.statusCode === 200
        ) {
          const body = await collect(response);
          // The rewritten HTML is decoded. Other streams keep their content-encoding.
          delete out['content-encoding'];
          res.writeHead(200, { ...out, 'cache-control': 'no-store' });
          res.end(decorate(body, route));
        } else {
          res.writeHead(response.statusCode ?? 502, out);
          if (eventStream) res.flushHeaders();
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
}

// Forward local dev-server WebSockets (including common HMR) without a WS library.
export function upgradeApplication(
  req: IncomingMessage,
  socket: import('node:stream').Duplex,
  head: Buffer,
  origin: string,
  upstreamOrigin: string,
) {
  if (
    !upstreamOrigin ||
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
}
