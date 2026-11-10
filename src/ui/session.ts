import type { WorkspaceView } from '../shared/feedback.js';

/**
 * Credentialed access to one session.
 * Requests run in order, so a slow read never replaces the result of a later write.
 */
export function createSession(id: string) {
  const key = `humagent:key:${id}`;
  // The URL fragment carries the credential once. Session storage keeps it for this tab.
  if (location.hash) {
    sessionStorage.setItem(key, location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
  }
  const credential = sessionStorage.getItem(key) ?? '';
  let queue: Promise<unknown> = Promise.resolve();
  function request<T>(action: string, method: string, data?: unknown) {
    const result = queue.then(async () => {
      if (!credential)
        throw new Error('Open this session through the Humagent CLI.');
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
      return body as T;
    });
    queue = result.catch(() => {});
    return result;
  }
  return {
    read: () => request<WorkspaceView>('', 'GET'),
    /** Every write returns the fresh session view. */
    write: <T extends object = object>(
      action: string,
      method: string,
      data?: unknown,
    ) => request<T & { session: WorkspaceView }>(action, method, data),
  };
}
