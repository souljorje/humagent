/** A client of a running server, for the agent's commands. It holds the control token. */
import type { OpenedSession, WriteReply } from '../shared/api.js';
import type { SessionView, WorkspaceView } from '../shared/feedback.js';
import { readRecord, type ServerRecord } from './record.js';
import type { Store } from './sessions/store.js';

type WaitResult = Awaited<ReturnType<Store['wait']>>;

function createClient({ origin, token, version }: ServerRecord) {
  async function request<T>(
    route: string,
    method = 'GET',
    data?: unknown,
    /** Zero waits without a limit. */
    timeout = 65000,
  ) {
    const response = await fetch(origin + route, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
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
  const session = (id: string, operation = '') =>
    `/api/sessions/${encodeURIComponent(id)}${operation}`;
  return {
    version,
    open: (source: string, network: boolean) =>
      request<OpenedSession>('/api/open', 'POST', { source, network }),
    sessions: () =>
      request<{
        sessions: SessionView[];
        errors: { id: string; message: string }[];
      }>('/api/sessions'),
    session: (id: string) => request<WorkspaceView>(session(id)),
    complete: (id: string, receipt: string) =>
      request<SessionView>(session(id, '/complete'), 'POST', { receipt }),
    /** Wait without a limit until the human sends feedback or the session ends. */
    wait: (id: string) =>
      request<WaitResult>(session(id, '/wait'), 'POST', {}, 0),
    end: (id: string) => request<WriteReply>(session(id, '/end'), 'POST', {}),
    stop: () => request<{ stopped: boolean }>('/api/stop', 'POST', {}),
  };
}
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
