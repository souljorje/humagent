import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { version } from './version.js';
import { ensure, Failure, MAX_BYTES, object } from './protocol.js';
import {
  targetOf,
  sourceRevision,
  startSurface,
  type Surface,
} from './surfaces.js';
import { writeJson } from './storage.js';
import { browserAsset } from './assets.js';
import type { Session } from './protocol.js';

export interface SessionSnapshot extends Omit<
  Session,
  'viewKey' | 'lease' | 'acknowledged'
> {
  agent: 'working' | 'waiting' | 'idle';
  surface: { origin: string; frameUrl: string; channel: string };
}

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
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        ensure(total <= MAX_BYTES, 'Body exceeds 256 KiB', 'TOO_LARGE', 413);
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new Failure(400, 'INVALID_JSON', 'Malformed JSON');
  }
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
  const waiters = new Set<string>();
  const streams = new Set<() => void>();
  const cancels = new Set<() => void>();
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
  function view(id: string): Omit<SessionSnapshot, 'surface'> {
    const { viewKey: _key, lease, acknowledged: _ack, ...s } = store.get(id);
    return {
      ...s,
      agent:
        lease && lease.expiresAt > Date.now()
          ? 'working'
          : waiters.has(id)
            ? 'waiting'
            : 'idle',
    };
  }
  async function snapshot(id: string): Promise<SessionSnapshot> {
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
      ['/app.js', '/app.css'].includes(pathname) ||
      /^\/(ui|shared)\/[a-z][a-z0-9-]*\.(js|css)$/.test(pathname)
    ) {
      await next();
      return;
    }
    const control = equal(c.req.header('authorization'), `Bearer ${token}`);
    const match = /^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/.exec(pathname);
    if (match) {
      const session = store.get(match[1]!);
      ensure(
        control || equal(c.req.header('x-humagent-session'), session.viewKey),
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
    // Hono dispatches HEAD through GET, but control routes did not allow it.
    if (c.req.method === 'HEAD')
      throw new Failure(
        404,
        'NOT_FOUND',
        match ? 'Unknown session operation' : 'Not found',
      );
    await next();
  });

  app.all('/health', () =>
    json(200, { app: 'humagent', protocol: 1, pid: process.pid, version }),
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
  for (const route of ['/workspace', '/app.js', '/app.css']) {
    app.all(route, (c) => {
      ensure(c.req.method === 'GET', 'Method not allowed', 'METHOD', 405);
      const name = route === '/workspace' ? 'index.html' : route.slice(1);
      return new Response(fs.readFileSync(path.join(UI, name)), {
        headers: {
          'content-type': name.endsWith('.js')
            ? 'text/javascript'
            : name.endsWith('.css')
              ? 'text/css'
              : 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'content-security-policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    });
  }

  const sessionPath = '/api/sessions/:id{[\\w-]+}';
  app.get(sessionPath, async (c) =>
    json(200, await snapshot(c.req.param('id'))),
  );
  app.post(`${sessionPath}/events`, async (c) => {
    const id = c.req.param('id');
    const value = await body(c.req.raw);
    await (await surface(id)).checkRevision();
    const session = store.get(id);
    if (
      !session.ended &&
      !session.events.some((event) => event.clientId === value.clientId)
    )
      ensure(
        view(id).agent !== 'idle',
        'Connect an agent before sending feedback.',
        'AGENT_UNAVAILABLE',
        409,
      );
    return json(200, store.send(id, value));
  });
  app.post(`${sessionPath}/surface`, async (c) => {
    const id = c.req.param('id');
    const value = await body(c.req.raw);
    (await surface(id)).activate(value.documentId);
    return json(200, view(id));
  });
  app.put(`${sessionPath}/state`, async (c) => {
    const value = await body(c.req.raw);
    store.saveState(c.req.param('id'), value.expectedVersion, value.state);
    return json(200, view(c.req.param('id')));
  });
  app.post(`${sessionPath}/end`, async (c) => {
    await body(c.req.raw);
    store.end(c.req.param('id'));
    return json(200, view(c.req.param('id')));
  });
  app.post(`${sessionPath}/ack`, async (c) => {
    const value = await body(c.req.raw);
    const id = c.req.param('id');
    store.acknowledge(id, value.receipt);
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
    const timeout = Number(value.timeoutMs ?? 50000),
      leaseMs = Number(value.leaseMs ?? 120000);
    ensure(
      Number.isInteger(timeout) && timeout >= 1 && timeout <= 600000,
      'timeoutMs must be 1–600000',
    );
    ensure(
      !waiters.has(id),
      'Another agent is already waiting',
      'LISTENER_ACTIVE',
      409,
    );
    const signal = c.req.raw.signal;
    if (signal.aborted) return json(200, { status: 'interrupted' });
    const take = () =>
      store.take(id, String(value.consumer ?? 'agent'), leaseMs);
    const immediate = take();
    if (immediate) return json(200, immediate);
    waiters.add(id);
    store.emit('change', id);
    return new Promise<Response>((resolve) => {
      let done = false,
        processing = false;
      const cleanup = () => {
        if (done) return false;
        done = true;
        clearTimeout(timer);
        clearInterval(tick);
        store.off('change', changed);
        signal.removeEventListener('abort', cancel);
        waiters.delete(id);
        cancels.delete(cancel);
        store.emit('change', id);
        return true;
      };
      const cancel = () => {
        if (cleanup()) resolve(json(200, { status: 'interrupted' }));
      };
      const changed = (session: string) => {
        if (session !== id || done || processing) return;
        processing = true;
        try {
          const next = take();
          if (next && cleanup()) resolve(json(200, next));
        } catch (error) {
          if (cleanup()) resolve(fail(error));
        } finally {
          processing = false;
        }
      };
      const timer = setTimeout(() => {
        if (cleanup()) resolve(json(200, { status: 'timeout' }));
      }, timeout);
      const tick = setInterval(() => changed(id), 500);
      store.on('change', changed);
      cancels.add(cancel);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  });
  app.get(`${sessionPath}/stream`, (c) => {
    const id = c.req.param('id');
    const signal = c.req.raw.signal;
    const response = streamSSE(c, async (stream) => {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        clearInterval(heartbeat);
        store.off('change', changed);
        signal.removeEventListener('abort', cleanup);
        streams.delete(cleanup);
        finish();
      };
      const changed = (key: string) => {
        if (key === id && !done)
          void stream.writeSSE({ event: 'change', data: '{}' });
      };
      const heartbeat = setInterval(() => {
        void stream.write(': heartbeat\n\n');
      }, 15000);
      store.on('change', changed);
      streams.add(cleanup);
      stream.onAbort(cleanup);
      signal.addEventListener('abort', cleanup, { once: true });
      if (signal.aborted) cleanup();
      try {
        await Promise.race([
          stream.writeSSE({ event: 'ready', data: '{}' }),
          finished,
        ]);
        await finished;
      } finally {
        cleanup();
      }
    });
    response.headers.set('cache-control', 'no-store');
    return response;
  });
  app.all(sessionPath, () => {
    throw new Failure(404, 'NOT_FOUND', 'Unknown session operation');
  });
  app.all(`${sessionPath}/:action{\\w+}`, () => {
    throw new Failure(404, 'NOT_FOUND', 'Unknown session operation');
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
  const workspaceFile = path.join(directory, 'workspace.json');
  let port = options.port;
  try {
    if (port === undefined && fs.existsSync(workspaceFile)) {
      const saved = JSON.parse(fs.readFileSync(workspaceFile, 'utf8'));
      ensure(
        Number.isInteger(saved.port) && saved.port > 0 && saved.port <= 65535,
        'Stored workspace port is invalid. Restore workspace.json.',
      );
      port = saved.port;
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port ?? 0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    writeJson(workspaceFile, { port: Number(new URL(origin).port) });
    await Promise.all(store.list().map((session) => surface(session.id)));
    writeJson(path.join(directory, 'server.json'), {
      protocol: 1,
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
      for (const cancel of cancels) cancel();
      for (const stream of streams) stream();
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
