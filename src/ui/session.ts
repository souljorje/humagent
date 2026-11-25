import {
  SESSION_HEADER,
  type SaveReply,
  type WriteReply,
} from '../shared/api.js';
import type { WorkspaceView } from '../shared/feedback.js';
import type { prepareEdit, prepareSave } from './reviews.js';

interface Options {
  /** The newest session view. */
  view(view: WorkspaceView): void;
  /** A write failed, so the shown view can be old. */
  failed(): void;
}

/**
 * Credentialed access to one session. Writes run one at a time, in order.
 * A response reaches `view` only if no request sent later has already reached it,
 * so a slow read never replaces the result of a newer write.
 */
export function createSession(id: string, options: Options) {
  const key = `humagent:key:${id}`;
  // The URL fragment carries the credential once. Session storage keeps it for this tab.
  if (location.hash) {
    sessionStorage.setItem(key, location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
  }
  const credential = sessionStorage.getItem(key) ?? '';
  let sent = 0,
    shown = 0;
  async function request<T>(action: string, method: string, data?: unknown) {
    if (!credential)
      throw new Error('Open this session through the Humagent CLI.');
    const ticket = ++sent;
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
    if (view && ticket > shown) {
      shown = ticket;
      options.view(view);
    }
    return body as T;
  }
  let writes: Promise<unknown> = Promise.resolve();
  /** Every write returns the fresh session view. */
  function write<T extends WriteReply = WriteReply>(
    action: string,
    method: string,
    data?: unknown,
  ) {
    const result = writes.then(() => request<T>(action, method, data));
    writes = result.catch(() => {});
    return result.catch((error: unknown) => {
      options.failed();
      throw error;
    });
  }
  const review = (reviewId: string) =>
    `reviews/${encodeURIComponent(reviewId)}`;
  return {
    read: () => request<WorkspaceView>('', 'GET'),
    attachPage: (documentId: string) => write('page', 'POST', { documentId }),
    saveReview: (
      checked: ReturnType<typeof prepareSave> & { revision: string },
    ) => write<SaveReply>('reviews', 'POST', checked),
    editReview: (
      reviewId: string,
      changes: ReturnType<typeof prepareEdit> & { revision: string },
    ) => write(review(reviewId), 'PATCH', changes),
    removeReview: (reviewId: string, revision: string) =>
      write(
        `${review(reviewId)}?revision=${encodeURIComponent(revision)}`,
        'DELETE',
      ),
    setInstruction: (instruction: string) =>
      write('instruction', 'PUT', { instruction }),
    send: (revision: string | undefined) => write('send', 'POST', { revision }),
    end: () => write('end', 'POST', {}),
  };
}
