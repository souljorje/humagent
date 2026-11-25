import { randomBytes } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { Failure } from '@/shared/validate';
import { createApp } from './control/app';
import { fail } from './control/http';
import type { Client } from './pages/page-server';
import { claimDirectory } from './record';
import {
  closePages,
  closeRuntime,
  closeServer,
  pageServer,
  type Runtime,
} from './runtime';
import { Store } from './sessions/store';
import { version } from './version';

export interface ServerOptions {
  directory: string;
  port?: number;
  /** Where browser code comes from in development. Without it, the server uses its own build. */
  client?: Client;
}
type Listener = ReturnType<typeof getRequestListener>;

function openStore(directory: string) {
  const claim = claimDirectory(directory);
  try {
    return { claim, store: new Store(directory) };
  } catch (error) {
    claim.release();
    throw error;
  }
}

function createRuntime({ client, ...options }: ServerOptions): Runtime {
  const directory = path.resolve(options.directory);
  return {
    directory,
    ...openStore(directory),
    token: randomBytes(32).toString('hex'),
    client,
    pageServers: new Map(),
    viewed: new Map(),
    origin: '',
  };
}

async function handle(
  { origin }: Runtime,
  listener: Listener,
  req: IncomingMessage,
  res: ServerResponse,
) {
  // The adapter parses Host before it invokes Hono, so check it here.
  if (req.headers.host === new URL(origin).host) {
    await listener(req, res);
    return;
  }
  const refusal = fail(new Failure(403, 'FORBIDDEN', 'Invalid host'));
  res.writeHead(refusal.status, Object.fromEntries(refusal.headers));
  res.end(await refusal.text());
}

async function listen(server: http.Server, port = 0) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
  await promise;
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** One runtime owns a directory. Files stay read-only; agents apply proposals. */
export async function createServer(options: ServerOptions) {
  const runtime = createRuntime(options);
  const app = createApp(runtime, () => closeRuntime(runtime, server));
  const listener = getRequestListener(app.fetch, {
    overrideGlobalObjects: false,
    errorHandler: fail,
  });
  const server = http.createServer(
    (req, res) => void handle(runtime, listener, req, res),
  );
  try {
    runtime.origin = await listen(server, options.port);
    await Promise.all(
      runtime.store.list().map(({ id }) => pageServer(runtime, id)),
    );
    const { origin, token } = runtime;
    runtime.claim.publish({ origin, token, version });
  } catch (error) {
    await Promise.allSettled(closePages(runtime));
    if (server.listening) await closeServer(server);
    runtime.claim.release();
    throw error;
  }
  return {
    origin: runtime.origin,
    token: runtime.token,
    store: runtime.store,
    app,
    close: () => closeRuntime(runtime, server),
  };
}
