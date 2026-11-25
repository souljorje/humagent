/** A client of a running server, for the agent's commands. It holds the control token. */
import type { OpenedSession, WriteReply } from '@/shared/api';
import type { SessionView, WorkspaceView } from '@/shared/feedback';
import { readRecord, type ServerRecord } from './record';
import type { Store } from './sessions/store';

type WaitResult = Awaited<ReturnType<Store['wait']>>;

/** The longest time for a reply. */
const REPLY_LIMIT = 65000;

/** Send a request. A limit of zero waits without a limit. */
async function request<T>(
  { origin, token }: ServerRecord,
  route: string,
  method = 'GET',
  data?: unknown,
  limit = REPLY_LIMIT,
) {
  const response = await fetch(origin + route, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    ...(limit ? { signal: AbortSignal.timeout(limit) } : {}),
  });
  const result = (await response.json()) as {
    message?: string;
    error?: string;
  };
  // A wait reports late errors in its body, after a 200 status.
  if (!response.ok || result.error)
    throw new Error(`${result.error}: ${result.message}`);
  return result as T;
}

const sessionRoute = (id: string, operation = '') =>
  `/api/sessions/${encodeURIComponent(id)}${operation}`;

const createClient = (server: ServerRecord) => ({
  version: server.version,
  open: (source: string, network: boolean) =>
    request<OpenedSession>(server, '/api/open', 'POST', { source, network }),
  sessions: () =>
    request<{
      sessions: SessionView[];
      errors: { id: string; message: string }[];
    }>(server, '/api/sessions'),
  session: (id: string) => request<WorkspaceView>(server, sessionRoute(id)),
  complete: (id: string, receipt: string) =>
    request<SessionView>(server, sessionRoute(id, '/complete'), 'POST', {
      receipt,
    }),
  /** Wait without a limit until the human sends feedback or the session ends. */
  wait: (id: string) =>
    request<WaitResult>(server, sessionRoute(id, '/wait'), 'POST', {}, 0),
  end: (id: string) =>
    request<WriteReply>(server, sessionRoute(id, '/end'), 'POST', {}),
  stop: () => request<{ stopped: boolean }>(server, '/api/stop', 'POST', {}),
});
export type Client = ReturnType<typeof createClient>;

/** Return a client only when the recorded server of this directory answers its health check. */
export async function connect(directory: string): Promise<Client | null> {
  const record = readRecord(directory);
  if (!record) return null;
  try {
    const response = await fetch(`${record.origin}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const info = (await response.json()) as { app?: string; pid?: number };
    return response.ok && info.app === 'humagent' && info.pid === record.pid
      ? createClient(record)
      : null;
  } catch {
    return null;
  }
}
