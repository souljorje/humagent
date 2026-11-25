import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SESSION_HEADER, type OpenedSession } from '../shared/api.js';
import type { WorkspaceView } from '../shared/feedback.js';
import { ensure, Failure } from '../shared/validate.js';
import { authorize } from './control/access.js';
import { body, fail, json } from './control/http.js';
import { registerPublicRoutes } from './control/public-routes.js';
import {
  registerSessionActions,
  sessionPath,
} from './control/session-routes.js';
import { startPageServer, type PageServer } from './pages/page-server.js';
import { sourceOf, sourceRevision } from './pages/sources.js';
import { claimDirectory } from './record.js';
import { Store } from './sessions/store.js';
import { version } from './version.js';

function openStore(directory: string) {
  const claim = claimDirectory(directory);
  try {
    return { claim, store: new Store(directory) };
  } catch (error) {
    claim.release();
    throw error;
  }
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
  const { claim, store } = openStore(directory);
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
    const opened: OpenedSession = {
      session: s.id,
      url: `${origin}/?session=${s.id}#${s.sessionKey}`,
      // A browser already shows this session, so the caller need not open another.
      viewing: Date.now() - (viewed.get(s.id) ?? 0) < 3000,
      source: s.source,
      note:
        source.kind === 'file'
          ? `Only supported files in ${source.root} are served. Source is read-only.`
          : 'Trusted local app proxy. Cookies and cookie authentication are not supported.',
    };
    return json(200, opened);
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
    if (c.req.header(SESSION_HEADER)) viewed.set(id, Date.now());
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
    claim.publish({ origin, token, version });
  } catch (e) {
    await Promise.allSettled(
      [...pageServers.values()].map(async (pending) => (await pending).close()),
    );
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    claim.release();
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
      // A later server replaces a record that this one could not remove.
      try {
        claim.release();
      } catch {}
    })();
    return closing;
  };
  return { origin, token, store, app, close };
}
