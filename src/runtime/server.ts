import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store, sessionView } from './store.js';
import { createWaiters } from './waiters.js';
import { version } from './version.js';
import { ensure, Failure, object, parseJson } from './validate.js';
import {
  targetOf,
  sourceRevision,
  startSurface,
  type Surface,
} from './surfaces.js';
import { writeJson } from './storage.js';
import { browserAsset } from './assets.js';
import { LIMITS, type WorkspaceView } from '../shared/feedback.js';

const UI = fileURLToPath(new URL('../ui/', import.meta.url));
const equal = (a: unknown, b: string) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

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

export interface RuntimeOptions {
  directory: string;
  port?: number;
}
/** One runtime owns a directory. Files stay read-only; agents apply proposals. */
export async function createRuntime(options: RuntimeOptions) {
  const directory = path.resolve(options.directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'server.lock');
  try {
    const fd = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch {
    let alive = true;
    const pid = Number(fs.readFileSync(lock, 'utf8'));
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
    fs.unlinkSync(lock);
    const fd = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
  }
  let store: Store;
  try {
    store = new Store(directory);
  } catch (error) {
    fs.unlinkSync(lock);
    throw error;
  }
  const token = randomBytes(32).toString('hex');
  const surfaces = new Map<string, Promise<Surface>>();
  const waiters = createWaiters(store);
  let origin = '';
  let closing: Promise<void> | undefined;
  function surface(id: string) {
    store.get(id);
    if (!surfaces.has(id)) {
      const p = startSurface(store, id, origin).catch((e) => {
        surfaces.delete(id);
        throw e;
      });
      surfaces.set(id, p);
    }
    return surfaces.get(id)!;
  }
  const view = (id: string) =>
    sessionView(store.get(id), waiters.isWaiting(id));
  async function snapshot(id: string): Promise<WorkspaceView> {
    store.get(id);
    const panel = await surfaces.get(id);
    ensure(
      panel,
      'Session is not attached. Open its target again.',
      'NOT_ATTACHED',
      409,
    );
    return {
      ...view(id),
      surface: {
        origin: panel.origin,
        frameUrl: panel.frameUrl,
        channel: panel.channel,
      },
    };
  }
  /** Workspace writes return the fresh session, so the browser never guesses the result. */
  const reply = async (id: string, extra: object = {}) =>
    json(200, { ...extra, session: await snapshot(id) });
  function checkHost(host: string | undefined) {
    ensure(host === new URL(origin).host, 'Invalid host', 'FORBIDDEN', 403);
  }
  const app = new Hono({ getPath: (request) => new URL(request.url).pathname });
  app.onError((error) => fail(error));
  app.use('*', async (c, next) => {
    checkHost(c.req.header('host'));
    const from = c.req.header('origin');
    ensure(
      !from || from === origin,
      'Cross-origin control requests are forbidden',
      'FORBIDDEN',
      403,
    );
    const pathname = new URL(c.req.url).pathname;
    if (
      pathname === '/health' ||
      pathname === '/workspace' ||
      /^\/(ui|shared)\/[a-z][a-z0-9-]*\.(js|css)$/.test(pathname)
    ) {
      await next();
      return;
    }
    const control = equal(c.req.header('authorization'), `Bearer ${token}`);
    const match = /^\/api\/sessions\/([\w-]+)(?:\/(\w+)(?:\/[^/]+)?)?$/.exec(
      pathname,
    );
    if (match) {
      let viewKey: string | undefined;
      try {
        viewKey = store.get(match[1]!).viewKey;
      } catch (error) {
        // Without the control token, an unknown session looks like a wrong key.
        const unknown = error instanceof Failure && error.code === 'NOT_FOUND';
        if (control || !unknown) throw error;
      }
      ensure(
        control ||
          (viewKey !== undefined &&
            equal(c.req.header('x-humagent-session'), viewKey)),
        'Unauthorized',
        'UNAUTHORIZED',
        401,
      );
      ensure(
        !['wait', 'ack', 'renew'].includes(match[2] ?? '') || control,
        'This operation requires the agent credential',
        'UNAUTHORIZED',
        401,
      );
    } else {
      ensure(control, 'Unauthorized', 'UNAUTHORIZED', 401);
    }
    // Hono dispatches HEAD through GET, but control routes do not allow it.
    if (c.req.method === 'HEAD')
      throw new Failure(
        404,
        'NOT_FOUND',
        match ? 'Unknown session operation' : 'Not found',
      );
    await next();
  });

  app.all('/health', () =>
    json(200, { app: 'humagent', pid: process.pid, version }),
  );
  for (const root of ['ui', 'shared']) {
    app.get(`/${root}/:file`, async (c) => {
      const name = `${root}/${c.req.param('file')}`;
      const asset = await browserAsset(name, ['ui', 'shared']);
      ensure(asset, 'Not found', 'NOT_FOUND', 404);
      return new Response(asset, {
        headers: {
          'content-type': name.endsWith('.css')
            ? 'text/css'
            : 'text/javascript',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    });
  }
  app.all('/workspace', (c) => {
    ensure(c.req.method === 'GET', 'Method not allowed', 'METHOD', 405);
    return new Response(fs.readFileSync(path.join(UI, 'index.html')), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      },
    });
  });

  const sessionPath = '/api/sessions/:id{[\\w-]+}';
  app.get(sessionPath, async (c) =>
    json(200, await snapshot(c.req.param('id'))),
  );
  app.post(`${sessionPath}/drafts`, async (c) => {
    const id = c.req.param('id');
    const draftId = store.addDraft(id, await body(c.req.raw));
    return reply(id, { draftId });
  });
  app.patch(`${sessionPath}/drafts/:draft`, async (c) => {
    const id = c.req.param('id');
    store.editDraft(id, c.req.param('draft'), await body(c.req.raw));
    return reply(id);
  });
  app.delete(`${sessionPath}/drafts/:draft`, async (c) => {
    const id = c.req.param('id');
    store.removeDraft(id, c.req.param('draft'));
    return reply(id);
  });
  app.put(`${sessionPath}/message`, async (c) => {
    const id = c.req.param('id');
    store.setMessage(id, (await body(c.req.raw)).text);
    return reply(id);
  });
  app.post(`${sessionPath}/send`, async (c) => {
    const id = c.req.param('id');
    const value = await body(c.req.raw);
    await (await surface(id)).checkRevision();
    ensure(
      store.get(id).ended || view(id).agent !== 'idle',
      'Connect an agent before sending feedback.',
      'AGENT_UNAVAILABLE',
      409,
    );
    const event = store.send(id, value.revision);
    return reply(id, { event });
  });
  app.post(`${sessionPath}/surface`, async (c) => {
    const id = c.req.param('id');
    const value = await body(c.req.raw);
    (await surface(id)).activate(value.documentId);
    return reply(id);
  });
  app.post(`${sessionPath}/end`, async (c) => {
    const id = c.req.param('id');
    await body(c.req.raw);
    store.end(id);
    return reply(id);
  });
  app.post(`${sessionPath}/ack`, async (c) => {
    const id = c.req.param('id');
    store.acknowledge(id, (await body(c.req.raw)).receipt);
    return json(200, view(id));
  });
  app.post(`${sessionPath}/renew`, async (c) => {
    const value = await body(c.req.raw);
    store.renew(
      c.req.param('id'),
      value.receipt,
      value.leaseMs as number | undefined,
    );
    return json(200, { ok: true });
  });
  app.post(`${sessionPath}/wait`, async (c) => {
    const value = await body(c.req.raw);
    const id = c.req.param('id');
    const { min, max } = LIMITS.waitMs;
    const timeout = Number(value.timeoutMs ?? LIMITS.waitMs.default),
      leaseMs = Number(value.leaseMs ?? LIMITS.leaseMs.default);
    ensure(
      Number.isInteger(timeout) && timeout >= min && timeout <= max,
      `timeoutMs must be ${min}–${max}`,
    );
    const consumer = String(value.consumer ?? 'agent');
    return json(
      200,
      await waiters.wait(
        id,
        () => store.take(id, consumer, leaseMs),
        timeout,
        c.req.raw.signal,
      ),
    );
  });

  app.post('/api/open', async (c) => {
    const value = await body(c.req.raw);
    ensure(typeof value.target === 'string', 'target is required');
    const target = await targetOf(value.target, value.network === true);
    if (target.kind === 'file') {
      const relative = path.relative(target.root!, directory);
      ensure(
        relative.startsWith('..') || path.isAbsolute(relative),
        'Use an artifact directory that does not contain Humagent private state',
        'FORBIDDEN',
        403,
      );
    }
    const revision = await sourceRevision(target);
    const s = store.open(target, revision);
    await surface(s.id);
    return json(200, {
      session: s.id,
      url: `${origin}/workspace?session=${s.id}#${s.viewKey}`,
      target: s.target,
      note:
        target.kind === 'file'
          ? `Only supported files in ${target.root} are served. Source is read-only.`
          : 'Trusted local app proxy. Cookies/authenticated apps are not supported in v0.1.',
    });
  });
  app.post('/api/stop', async (c) => {
    await body(c.req.raw);
    setTimeout(() => {
      void close();
    }, 25);
    return json(200, { stopped: true });
  });
  app.get('/api/sessions', () =>
    json(200, {
      sessions: store.list().map((s) => view(s.id)),
      errors: store.errors(),
    }),
  );
  app.all('/api/sessions/*', () => {
    throw new Failure(404, 'NOT_FOUND', 'Unknown session operation');
  });
  app.notFound(() => fail(new Failure(404, 'NOT_FOUND', 'Not found')));

  const listener = getRequestListener(app.fetch, {
    overrideGlobalObjects: false,
    errorHandler: fail,
  });
  const server = http.createServer((req, res) => {
    try {
      // The adapter parses Host before it invokes the Hono middleware.
      checkHost(req.headers.host);
    } catch (error) {
      const response = fail(error);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      void response.text().then((text) => res.end(text));
      return;
    }
    void listener(req, res);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    await Promise.all(store.list().map((session) => surface(session.id)));
    writeJson(path.join(directory, 'server.json'), {
      pid: process.pid,
      origin,
      token,
      version,
    });
  } catch (e) {
    await Promise.allSettled(
      [...surfaces.values()].map(async (pending) => (await pending).close()),
    );
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.unlinkSync(lock);
    throw e;
  }
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      waiters.cancelAll();
      await Promise.all(
        [...surfaces.values()].map(async (p) => (await p).close()),
      );
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const name of ['server.json', 'server.lock'])
        try {
          fs.unlinkSync(path.join(directory, name));
        } catch {}
    })();
    return closing;
  };
  return { origin, token, store, app, close };
}
function fail(error: unknown) {
  const status = error instanceof Failure ? error.status : 400;
  return json(status, {
    error: error instanceof Failure ? error.code : 'ERROR',
    message: error instanceof Error ? error.message : 'Request failed',
  });
}
