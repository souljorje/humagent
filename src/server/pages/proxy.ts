/** The proxy to a local app: requests and WebSocket upgrades. */
import http, {
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { Duplex } from 'node:stream';
import { ensure } from '@/shared/validate';
import type { Decorate } from './documents';
import { fail } from './failure';
import { collect } from './upstream';

const REQUEST_LIMIT = 15000;
const UPGRADE_LIMIT = 10000;
const DROPPED_HEADERS = [
  'connection',
  'transfer-encoding',
  'content-length',
  'set-cookie',
];

interface Exchange {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly route: string;
  readonly origin: string;
  readonly upstreamOrigin: string;
  readonly decorate: Decorate | undefined;
}

/** Headers without some names. */
function without(headers: IncomingHttpHeaders, names: readonly string[]) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !names.includes(name)),
  ) as IncomingHttpHeaders;
}

const contentType = ({ headers }: IncomingMessage) =>
  headers['content-type'] ?? '';

const isEventStream = (response: IncomingMessage) =>
  contentType(response).split(';')[0]!.trim().toLowerCase() ===
  'text/event-stream';

/** The headers for the browser. A redirect stays inside the app, on the page origin. */
function responseHeaders(
  { origin, route, upstreamOrigin }: Exchange,
  { headers }: IncomingMessage,
): IncomingHttpHeaders {
  const kept = without(headers, DROPPED_HEADERS);
  if (!headers.location) return kept;
  const redirect = new URL(headers.location, new URL(route, upstreamOrigin));
  ensure(
    redirect.origin === upstreamOrigin,
    'Redirect leaves configured local application',
    'UPSTREAM_REDIRECT',
    502,
  );
  const location = origin + redirect.pathname + redirect.search + redirect.hash;
  return { ...kept, location };
}

async function sendResponse(exchange: Exchange, response: IncomingMessage) {
  const { decorate, res, route } = exchange;
  const { statusCode } = response;
  const headers = responseHeaders(exchange, response);
  const isDocument =
    contentType(response).includes('text/html') && statusCode === 200;
  if (!decorate || !isDocument) {
    res.writeHead(statusCode ?? 502, headers);
    if (isEventStream(response)) res.flushHeaders();
    response.pipe(res);
    return;
  }
  const body = await collect(response);
  // The rewritten HTML is decoded. Other streams keep their content-encoding.
  res.writeHead(200, {
    ...without(headers, ['content-encoding']),
    'cache-control': 'no-store',
  });
  res.end(decorate(body, route));
}

async function onResponse(
  exchange: Exchange,
  upstream: ClientRequest,
  response: IncomingMessage,
) {
  // Keep the initial timeout, but allow an established event stream to stay silent.
  if (isEventStream(response)) upstream.setTimeout(0);
  try {
    await sendResponse(exchange, response);
  } catch (error) {
    response.destroy();
    fail(exchange.res, error);
  }
}

export function proxyApplication(exchange: Exchange) {
  const { req, res, route, upstreamOrigin } = exchange;
  // Never accept a URL parameter or follow redirects. A route such as `/..//host` names another host.
  const destination = new URL(route, upstreamOrigin);
  ensure(destination.origin === upstreamOrigin, 'Invalid request path');
  const upstream = http.request(destination, {
    method: req.method,
    headers: {
      // No implicit browser credentials forwarded into a development app.
      ...without(req.headers, ['cookie', 'connection']),
      host: destination.host,
      'accept-encoding': 'identity',
      ...(req.headers.origin ? { origin: upstreamOrigin } : {}),
    },
    timeout: REQUEST_LIMIT,
  });
  upstream.on(
    'response',
    (response) => void onResponse(exchange, upstream, response),
  );
  upstream.on('timeout', () =>
    upstream.destroy(new Error('Local application timed out')),
  );
  upstream.on('error', (error) => fail(res, error));
  req.pipe(upstream);
  // A browser that leaves ends the request to the app.
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });
}

/** Join a browser and the app. Each side ends the other one. */
function onUpgrade(
  socket: Duplex,
  head: Buffer,
  { statusCode, statusMessage, rawHeaders }: IncomingMessage,
  peer: Duplex,
  initial: Buffer,
) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n`);
  for (let i = 0; i < rawHeaders.length; i += 2)
    socket.write(`${rawHeaders[i]}: ${rawHeaders[i + 1]}\r\n`);
  socket.write('\r\n');
  if (initial.length) socket.write(initial);
  if (head.length) peer.write(head);
  peer.pipe(socket);
  socket.pipe(peer);
  peer.on('error', () => socket.destroy());
  socket.on('error', () => peer.destroy());
  socket.on('close', () => peer.destroy());
  peer.on('close', () => socket.destroy());
}

// Forward local dev-server WebSockets (including common HMR) without a WS library.
export function upgradeApplication(
  { headers, url }: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  origin: string,
  upstreamOrigin: string,
) {
  if (
    !upstreamOrigin ||
    headers.host !== new URL(origin).host ||
    headers.origin !== origin ||
    !url?.startsWith('/') ||
    url.startsWith('//')
  ) {
    socket.destroy();
    return;
  }
  const destination = new URL(url, upstreamOrigin);
  const upstream = http.request(destination, {
    headers: {
      ...without(headers, ['cookie']),
      host: destination.host,
      origin: upstreamOrigin,
    },
    timeout: UPGRADE_LIMIT,
  });
  upstream.on('upgrade', (response, peer, initial) =>
    onUpgrade(socket, head, response, peer, initial),
  );
  upstream.on('response', () => socket.destroy());
  upstream.on('error', () => socket.destroy());
  upstream.on('timeout', () => upstream.destroy());
  upstream.end();
}
