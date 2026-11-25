import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import type { HonoRequest } from 'hono/request';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { version } from './version.js';
import { ensure, Failure, object, parseJson } from './validate.js';
import {
  sourceOf,
  sourceRevision,
  startPageServer,
  type PageServer,
} from './pages.js';
import { writeJson } from './storage.js';
import { browserAsset, noStore } from './assets.js';
import { LIMITS, type WorkspaceView } from '../shared/feedback.js';

const UI = fileURLToPath(new URL('../ui/', import.meta.url));
const equal = (a: unknown, b: string) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const JSON_HEADERS = noStore('application/json');
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
/** Public browser modules of the workspace. A plugin is one module, with helper files in its own directory. */
const ASSET =
  /^\/(?:ui|shared|plugins(?:\/[a-z][a-z0-9-]*)?)\/[a-z][a-z0-9-]*\.(?:js|css)$/;
/**
 * The credential each control path needs. Paths without a rule need the control token.
 * A `session` path also accepts the page key of its session. An `agent` path does not.
 * Only the operations that the workspace uses are `session` paths. Each other operation is an `agent` path.
 */
const ACCESS: [RegExp, 'none' | 'session' | 'agent'][] = [
  [/^\/(?:health)?$/, 'none'],
  [ASSET, 'none'],
  [
    /^\/api\/sessions\/([\w-]+)(?:\/(?:reviews(?:\/[^/]+)?|instruction|send|page|end))?$/,
    'session',
  ],
  [/^\/api\/sessions\/([\w-]+)\/.+$/, 'agent'],
];
function accessOf(pathname: string) {
  for (const [pattern, access] of ACCESS) {
    const match = pattern.exec(pathname);
    if (match) return [access, match[1]] as const;
  }
  return ['control', undefined] as const;
}
function authorize(
  req: HonoRequest,
  origin: string,
  token: string,
  store: Store,
) {
  const from = req.header('origin');
  ensure(
    !from || from === origin,
    'Cross-origin control requests are forbidden',
    'FORBIDDEN',
    403,
  );
  const [access, session] = accessOf(req.path);
  if (access === 'none') return;
  const control = equal(req.header('authorization'), `Bearer ${token}`);
  if (session === undefined)
    ensure(control, 'Unauthorized', 'UNAUTHORIZED', 401);
  else {
    let sessionKey: string | undefined;
    try {
      sessionKey = store.get(session).sessionKey;
    } catch (error) {
      // Without the control token, an unknown session looks like a wrong key.
      const unknown = error instanceof Failure && error.code === 'NOT_FOUND';
      if (control || !unknown) throw error;
    }
    ensure(
      control ||
        (sessionKey !== undefined &&
          equal(req.header('x-humagent-session'), sessionKey)),
      'Unauthorized',
      'UNAUTHORIZED',
      401,
    );
    ensure(
      control || access !== 'agent',
      'This operation requires the control token',
      'UNAUTHORIZED',
      401,
    );
  }
  // Hono dispatches HEAD through GET, but control routes do not allow it.
  if (req.method === 'HEAD')
    throw new Failure(
      404,
      'NOT_FOUND',
      session ? 'Unknown session operation' : 'Not found',
    );
}
/** A wait can last hours. Regular spaces keep idle-connection and fetch timeouts from ending it. */
const HEARTBEAT_MS = 5000;

async function body(req: Request) {
  ensure(
    req.headers.get('content-type')?.startsWith('application/json'),
    'Expected application/json',
    'CONTENT_TYPE',
    415,
  );
  let total = 0;
  const parts: Uint8Array[] = [];
  const reader = req.body?.getReader();
  for (let chunk = await reader?.read(); chunk && !chunk.done;) {
    total += chunk.value.byteLength;
    ensure(total <= LIMITS.bodyBytes, 'Body exceeds 256 KiB', 'TOO_LARGE', 413);
    parts.push(chunk.value);
    chunk = await reader!.read();
  }
  const value = parseJson(Buffer.concat(parts).toString('utf8'));
  object(value);
  return value;
}

function openStore(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // The record claims the directory before the store opens. It gains origin and token after listen.
  const record = path.join(directory, 'server.json');
  const claim = () => {
    const fd = fs.openSync(record, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    fs.closeSync(fd);
  };
  try {
    claim();
  } catch {
    let alive = true;
    let pid = 0;
    try {
      pid = Number(JSON.parse(fs.readFileSync(record, 'utf8')).pid);
    } catch {}
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (e) {
        alive = (e as NodeJS.ErrnoException).code !== 'ESRCH';
      }
    }
    ensure(
      !alive,
      'Another server owns this state directory',
      'SERVER_ACTIVE',
      409,
    );
    fs.unlinkSync(record);
    claim();
  }
  try {
    return { record, store: new Store(directory) };
  } catch (error) {
    fs.unlinkSync(record);
    throw error;
  }
}

const sessionPath = '/api/sessions/:id{[\\w-]+}';
function registerSessionActions(
  app: Hono,
  store: Store,
  pageServer: (id: string) => Promise<PageServer>,
  snapshot: (id: string) => Promise<WorkspaceView>,
) {
  /** Workspace writes return the fresh session, so the browser never guesses the result. */
  const reply = async (id: string, extra: object = {}) =>
    json(200, { ...extra, session: await snapshot(id) });
  app.post(`${sessionPath}/reviews`, async (c) => {
    const id = c.req.param('id');
    const reviewId = store.addReview(id, await body(c.req.raw));
    return reply(id, { reviewId });
  });
  app.patch(`${sessionPath}/reviews/:review`, async (c) => {
    const id = c.req.param('id');
    store.editReview(id, c.req.param('review'), await body(c.req.raw));
    return reply(id);
  });
  app.delete(`${sessionPath}/reviews/:review`, async (c) => {
    const id = c.req.param('id');
    store.removeReview(id, c.req.param('review'), c.req.query('revision'));
    return reply(id);
  });
  app.put(`${sessionPath}/instruction`, async (c) => {
    const id = c.req.param('id');
    store.setInstruction(id, (await body(c.req.raw)).instruction);
    return reply(id);
  });
  app.post(`${sessionPath}/send`, async (c) => {
    const id = c.req.param('id');
    const value = await body(c.req.raw);
    await (await pageServer(id)).checkRevision();
    ensure(
      store.get(id).ended || store.view(id).agent !== 'idle',
      'Connect an agent before sending feedback.',
      'AGENT_UNAVAILABLE',
      409,
    );
    const feedback = store.send(id, value.revision);
    return reply(id, { feedback });
  });
  app.post(`${sessionPath}/page`, async (c) => {
    const id = c.req.param('id');
    const value = await body(c.req.raw);
    (await pageServer(id)).activate(value.documentId);
    return reply(id);
  });
  app.post(`${sessionPath}/end`, async (c) => {
    const id = c.req.param('id');
    await body(c.req.raw);
    store.end(id);
    return reply(id);
  });
  app.post(`${sessionPath}/complete`, async (c) => {
    const id = c.req.param('id');
    store.complete(id, (await body(c.req.raw)).receipt);
    return json(200, store.view(id));
  });
  app.post(`${sessionPath}/wait`, async (c) => {
    await body(c.req.raw);
    const id = c.req.param('id');
    const stop = new AbortController();
    c.req.raw.signal.addEventListener('abort', () => stop.abort(), {
      once: true,
    });
    // Ownership and session errors throw here, before the response starts.
    const result = store.wait(id, stop.signal).catch(failure);
    let beat: ReturnType<typeof setInterval> | undefined;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          beat = setInterval(
            () => controller.enqueue(new Uint8Array([32])),
            HEARTBEAT_MS,
          );
          void result.then((value) => {
            clearInterval(beat);
            try {
              controller.enqueue(Buffer.from(JSON.stringify(value)));
              controller.close();
            } catch {
              // The agent disconnected. Unfinished feedback returns on its next wait.
            }
          });
        },
        cancel() {
          clearInterval(beat);
          stop.abort();
        },
      }),
      { headers: JSON_HEADERS },
    );
  });
}

function registerPublicRoutes(app: Hono) {
  app.all('/health', () =>
    json(200, { app: 'humagent', pid: process.pid, version }),
  );
  for (const route of [
    '/:root{ui|shared|plugins}/:file',
    '/plugins/:plugin/:file',
  ])
    app.get(route, async (c) => {
      const { body, headers } = await browserAsset(c.req.path, ASSET);
      return new Response(body, { headers });
    });
  app.all('/', (c) => {
    ensure(c.req.method === 'GET', 'Method not allowed', 'METHOD', 405);
    return new Response(fs.readFileSync(path.join(UI, 'index.html')), {
      headers: noStore('text/html; charset=utf-8', {
        'referrer-policy': 'no-referrer',
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      }),
    });
  });
}

function createControlServer(app: Hono, getOrigin: () => string) {
  const listener = getRequestListener(app.fetch, {
    overrideGlobalObjects: false,
    errorHandler: fail,
  });
  return http.createServer((req, res) => {
    try {
      // The adapter parses Host before it invokes Hono, so check it here.
      ensure(
        req.headers.host === new URL(getOrigin()).host,
        'Invalid host',
        'FORBIDDEN',
        403,
      );
    } catch (error) {
      const response = fail(error);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      void response.text().then((text) => res.end(text));
      return;
    }
    void listener(req, res);
  });
}

async function listen(server: http.Server, port?: number) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port ?? 0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
}

export interface ServerOptions {
  directory: string;
  port?: number;
}
/** One runtime owns a directory. Files stay read-only; agents apply proposals. */
export async function createServer(options: ServerOptions) {
  const directory = path.resolve(options.directory);
  const { record, store } = openStore(directory);
  const token = randomBytes(32).toString('hex');
  const pageServers = new Map<string, Promise<PageServer>>();
  let origin = '';
  let closing: Promise<void> | undefined;
  function pageServer(id: string) {
    store.get(id);
    if (!pageServers.has(id)) {
      const p = startPageServer(store, id, origin).catch((e) => {
        pageServers.delete(id);
        throw e;
      });
      pageServers.set(id, p);
    }
    return pageServers.get(id)!;
  }
  async function snapshot(id: string): Promise<WorkspaceView> {
    store.get(id);
    const panel = await pageServers.get(id);
    ensure(
      panel,
      'Session is not attached. Open its source again.',
      'NOT_ATTACHED',
      409,
    );
    return {
      ...store.view(id),
      page: {
        origin: panel.origin,
        frameUrl: panel.frameUrl,
        channel: panel.channel,
      },
    };
  }
  /** When a workspace last read each session. An open workspace reads about once per second. */
  const viewed = new Map<string, number>();
  async function openSession(req: Request) {
    const value = await body(req);
    ensure(typeof value.source === 'string', 'source is required');
    const source = await sourceOf(value.source, value.network === true);
    if (source.kind === 'file') {
      const relative = path.relative(source.root!, directory);
      ensure(
        relative.startsWith('..') || path.isAbsolute(relative),
        'Use an artifact directory that does not contain Humagent private state',
        'FORBIDDEN',
        403,
      );
    }
    const revision = await sourceRevision(source);
    const s = store.open(source, revision);
    await pageServer(s.id);
    return json(200, {
      session: s.id,
      url: `${origin}/?session=${s.id}#${s.sessionKey}`,
      // A browser already shows this session, so the caller need not open another.
      viewing: Date.now() - (viewed.get(s.id) ?? 0) < 3000,
      source: s.source,
      note:
        source.kind === 'file'
          ? `Only supported files in ${source.root} are served. Source is read-only.`
          : 'Trusted local app proxy. Cookies/authenticated apps are not supported in v0.1.',
    });
  }
  const app = new Hono({ getPath: (request) => new URL(request.url).pathname });
  app.onError((error) => fail(error));
  app.use('*', async (c, next) => {
    authorize(c.req, origin, token, store);
    await next();
  });

  registerPublicRoutes(app);

  app.get(sessionPath, async (c) => {
    const id = c.req.param('id');
    if (c.req.header('x-humagent-session')) viewed.set(id, Date.now());
    return json(200, await snapshot(id));
  });
  registerSessionActions(app, store, pageServer, snapshot);

  app.post('/api/open', (c) => openSession(c.req.raw));
  app.post('/api/stop', async (c) => {
    await body(c.req.raw);
    setTimeout(() => {
      void close();
    }, 25);
    return json(200, { stopped: true });
  });
  app.get('/api/sessions', () =>
    json(200, {
      sessions: store.list().map((s) => store.view(s.id)),
      errors: store.errors(),
    }),
  );
  app.all('/api/sessions/*', () => {
    throw new Failure(404, 'NOT_FOUND', 'Unknown session operation');
  });
  app.notFound(() => fail(new Failure(404, 'NOT_FOUND', 'Not found')));

  const server = createControlServer(app, () => origin);
  try {
    origin = await listen(server, options.port);
    await Promise.all(store.list().map((session) => pageServer(session.id)));
    writeJson(record, {
      pid: process.pid,
      origin,
      token,
      version,
    });
  } catch (e) {
    await Promise.allSettled(
      [...pageServers.values()].map(async (pending) => (await pending).close()),
    );
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.unlinkSync(record);
    throw e;
  }
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      store.interruptWaits();
      await Promise.all(
        [...pageServers.values()].map(async (p) => (await p).close()),
      );
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(record);
      } catch {}
    })();
    return closing;
  };
  return { origin, token, store, app, close };
}
function failure(error: unknown) {
  return {
    error: error instanceof Failure ? error.code : 'ERROR',
    message: error instanceof Error ? error.message : 'Request failed',
  };
}
function fail(error: unknown) {
  return json(error instanceof Failure ? error.status : 400, failure(error));
}
