/** One running server: its state, its page servers, and its end. */
import type http from 'node:http';
import path from 'node:path';
import type { OpenedSession } from '@/shared/api';
import type { WorkspaceView } from '@/shared/feedback';
import { ensure } from '@/shared/validate';
import { builtSdk } from './assets';
import {
  startPageServer,
  type Client,
  type PageServer,
} from './pages/page-server';
import { sourceOf, sourceRevision } from './pages/sources';
import type { Claim } from './record';
import type { Store } from './sessions/store';

/** An open workspace reads its session about once per second. */
const VIEWING_TIME = 3000;

export interface Runtime {
  readonly directory: string;
  readonly token: string;
  readonly store: Store;
  readonly claim: Claim;
  /** Where browser code comes from in development. */
  readonly client: Client | undefined;
  readonly pageServers: Map<string, Promise<PageServer>>;
  /** When a workspace last read each session. */
  readonly viewed: Map<string, number>;
  /** The control origin, after the server listens. */
  origin: string;
  closing?: Promise<void>;
}

const clientOf = ({ client, origin }: Runtime): Client =>
  client ?? { workspace: `${origin}/`, sdk: builtSdk() };

/** A failed start does not block the next one. */
async function startPage(runtime: Runtime, id: string, client: Client) {
  try {
    return await startPageServer(runtime.store, id, client);
  } catch (error) {
    runtime.pageServers.delete(id);
    throw error;
  }
}

export function pageServer(runtime: Runtime, id: string) {
  const running = runtime.pageServers.get(id);
  if (running) return running;
  const started = startPage(runtime, id, clientOf(runtime));
  runtime.pageServers.set(id, started);
  return started;
}

export async function snapshot(
  { pageServers, store }: Runtime,
  id: string,
): Promise<WorkspaceView> {
  const page = await pageServers.get(id);
  const session = store.view(id);
  ensure(
    page,
    'Session is not attached. Open its source again.',
    'NOT_ATTACHED',
    409,
  );
  const { origin, frameUrl, channel } = page;
  return { ...session, page: { origin, frameUrl, channel } };
}

export async function openSession(
  runtime: Runtime,
  value: string,
  network: boolean,
): Promise<OpenedSession> {
  const { directory, store, viewed } = runtime;
  const source = await sourceOf(value, network);
  const { kind, root } = source;
  if (kind === 'file') {
    const relative = path.relative(root!, directory);
    ensure(
      relative.startsWith('..') || path.isAbsolute(relative),
      'Use an artifact directory that does not contain Humagent private state',
      'FORBIDDEN',
      403,
    );
  }
  const session = store.open(source, await sourceRevision(source));
  const { id, sessionKey } = session;
  await pageServer(runtime, id);
  return {
    session: id,
    url: `${clientOf(runtime).workspace}?session=${id}#${sessionKey}`,
    // A browser already shows this session, so the caller need not open another.
    viewing: Date.now() - (viewed.get(id) ?? 0) < VIEWING_TIME,
    source: session.source,
    note:
      kind === 'file'
        ? `Only supported files in ${root} are served. Source is read-only.`
        : 'Trusted local app proxy. Cookies and cookie authentication are not supported.',
  };
}

async function closePage(page: Promise<PageServer>) {
  await (await page).close();
}

export const closePages = ({ pageServers }: Runtime) =>
  Array.from(pageServers.values(), closePage);

export async function closeServer(server: http.Server) {
  const { promise, resolve } = Promise.withResolvers<void>();
  server.closeAllConnections();
  server.close(() => resolve());
  await promise;
}

async function shutDown(runtime: Runtime, server: http.Server) {
  runtime.store.interruptWaits();
  await Promise.all(closePages(runtime));
  await closeServer(server);
  // A later server replaces a record that this one could not remove.
  try {
    runtime.claim.release();
  } catch {}
}

export function closeRuntime(runtime: Runtime, server: http.Server) {
  runtime.closing ??= shutDown(runtime, server);
  return runtime.closing;
}
