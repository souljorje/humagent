/** Credentialed access to one session. */
import { SESSION_HEADER, type SaveReply, type WriteReply } from '@/shared/api';
import type { WorkspaceView } from '@/shared/feedback';
import type { prepareEdit, prepareSave } from './reviews';

interface Options {
  /** The newest session view. */
  view(view: WorkspaceView): void;
  /** A write failed, so the shown view can be old. */
  failed(): void;
}
interface Access {
  readonly id: string;
  readonly credential: string;
  readonly options: Options;
  /** The number of the last sent request. */
  sent: number;
  /** The number of the request whose view is shown. */
  shown: number;
  /** Settles after the last write. */
  writes: Promise<unknown>;
}

async function request<T>(
  access: Access,
  action: string,
  method: string,
  data?: unknown,
) {
  const { credential, id, options } = access;
  if (!credential)
    throw new Error('Open this session through the Humagent CLI.');
  const ticket = ++access.sent;
  const response = await fetch(
    `/api/sessions/${id}${action ? '/' + action : ''}`,
    {
      method,
      headers: {
        [SESSION_HEADER]: credential,
        'content-type': 'application/json',
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error}: ${body.message}`);
  const view: WorkspaceView | undefined = action ? body.session : body;
  // A slow read never replaces the result of a newer write.
  if (view && ticket > access.shown) {
    access.shown = ticket;
    options.view(view);
  }
  return body as T;
}

/** Writes run one at a time, in order. Every write returns the fresh session view. */
async function write<T extends WriteReply = WriteReply>(
  access: Access,
  action: string,
  method: string,
  data?: unknown,
) {
  const result = access.writes.then(() =>
    request<T>(access, action, method, data),
  );
  access.writes = result.catch(() => {});
  try {
    return await result;
  } catch (error) {
    access.options.failed();
    throw error;
  }
}

const review = (reviewId: string) => `reviews/${encodeURIComponent(reviewId)}`;

export function createSession(id: string, options: Options) {
  const key = `humagent:key:${id}`;
  // The URL fragment carries the credential once. Session storage keeps it for this tab.
  if (location.hash) {
    sessionStorage.setItem(key, location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
  }
  const access: Access = {
    id,
    credential: sessionStorage.getItem(key) ?? '',
    options,
    sent: 0,
    shown: 0,
    writes: Promise.resolve(),
  };
  return {
    read: () => request<WorkspaceView>(access, '', 'GET'),
    attachPage: (documentId: string) =>
      write(access, 'page', 'POST', { documentId }),
    saveReview: (
      checked: ReturnType<typeof prepareSave> & { revision: string },
    ) => write<SaveReply>(access, 'reviews', 'POST', checked),
    editReview: (
      reviewId: string,
      changes: ReturnType<typeof prepareEdit> & { revision: string },
    ) => write(access, review(reviewId), 'PATCH', changes),
    removeReview: (reviewId: string, revision: string) =>
      write(
        access,
        `${review(reviewId)}?revision=${encodeURIComponent(revision)}`,
        'DELETE',
      ),
    setInstruction: (instruction: string) =>
      write(access, 'instruction', 'PUT', { instruction }),
    send: (revision: string | undefined) =>
      write(access, 'send', 'POST', { revision }),
    end: () => write(access, 'end', 'POST', {}),
  };
}
export type Session = ReturnType<typeof createSession>;
