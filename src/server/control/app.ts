/** The control routes. `access.ts` decides who can use each one. */
import { Hono, type Context, type Next } from 'hono';
import { SESSION_HEADER } from '@/shared/api';
import { ensure, Failure } from '@/shared/validate';
import { openSession, snapshot, type Runtime } from '@/server/runtime';
import { authorize } from './access';
import { body, fail, json } from './http';
import { registerPublicRoutes } from './public-routes';
import { registerSessionActions, sessionPath } from './session-routes';

/** The reply to a stop leaves before the server closes. */
const STOP_DELAY = 25;

async function checkAccess(
  { origin, token, store }: Runtime,
  { req }: Context,
  next: Next,
) {
  authorize(req, origin, token, store);
  await next();
}

async function open(runtime: Runtime, request: Request) {
  const { source, network } = await body(request);
  ensure(typeof source === 'string', 'source is required');
  return json(200, await openSession(runtime, source, network === true));
}

/** Read a session. A workspace sends its session key. */
async function read(runtime: Runtime, id: string, key: string | undefined) {
  if (key) runtime.viewed.set(id, Date.now());
  return json(200, await snapshot(runtime, id));
}

async function stop(request: Request, close: () => Promise<void>) {
  await body(request);
  setTimeout(() => void close(), STOP_DELAY);
  return json(200, { stopped: true });
}

export function createApp(runtime: Runtime, close: () => Promise<void>) {
  const { store } = runtime;
  const app = new Hono({ getPath: (request) => new URL(request.url).pathname });
  app.onError((error) => fail(error));
  app.use('*', (c, next) => checkAccess(runtime, c, next));
  registerPublicRoutes(app);
  app.get(sessionPath, ({ req }) =>
    read(runtime, req.param('id'), req.header(SESSION_HEADER)),
  );
  registerSessionActions(app, runtime);
  app.post('/api/open', ({ req }) => open(runtime, req.raw));
  app.post('/api/stop', ({ req }) => stop(req.raw, close));
  app.get('/api/sessions', () =>
    json(200, {
      sessions: store.list().map(({ id }) => store.view(id)),
      errors: store.errors(),
    }),
  );
  app.all('/api/sessions/*', () => {
    throw new Failure(404, 'NOT_FOUND', 'Unknown session operation');
  });
  app.notFound(() => fail(new Failure(404, 'NOT_FOUND', 'Not found')));
  return app;
}
