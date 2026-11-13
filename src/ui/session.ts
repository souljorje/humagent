import type { WorkspaceView } from '../shared/feedback.js';

/**
 * Credentialed access to one session. Writes run one at a time, in order.
 * A response reaches `onView` only if no request sent later has already reached it,
 * so a slow read never replaces the result of a newer write.
 */
export function createSession(
  id: string,
  onView: (view: WorkspaceView) => void,
) {
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
          'x-humagent-session': credential,
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
      onView(view);
    }
    return body as T;
  }
  let writes: Promise<unknown> = Promise.resolve();
  return {
    read: () => request<WorkspaceView>('', 'GET'),
    /** Every write returns the fresh session view. */
    write<T extends object = object>(
      action: string,
      method: string,
      data?: unknown,
    ) {
      const result = writes.then(() =>
        request<T & { session: WorkspaceView }>(action, method, data),
      );
      writes = result.catch(() => {});
      return result;
    },
  };
}
