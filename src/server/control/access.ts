/** Which credential each control path needs. */
import type { HonoRequest } from 'hono/request';
import { timingSafeEqual } from 'node:crypto';
import { SESSION_HEADER } from '../../shared/api.js';
import { ensure, Failure } from '../../shared/validate.js';
import { UI_ASSET } from '../assets.js';
import type { Store } from '../sessions/store.js';

const equal = (a: unknown, b: string) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
/**
 * The credential each control path needs. Paths without a rule need the control token.
 * A `session` path also accepts the page key of its session. An `agent` path does not.
 * Only the operations that the workspace uses are `session` paths. Each other operation is an `agent` path.
 */
const ACCESS: [RegExp, 'none' | 'session' | 'agent'][] = [
  [/^\/(?:health)?$/, 'none'],
  [UI_ASSET, 'none'],
  [
    /^\/api\/sessions\/([\w-]+)(?:\/(?:reviews(?:\/[^/]+)?|instruction|send|page|end))?$/,
    'session',
  ],
  [/^\/api\/sessions\/([\w-]+)\/.+$/, 'agent'],
];
function accessOf(pathname: string) {
  for (const [pattern, access] of ACCESS) {
    const match = pattern.exec(pathname);
    if (match) return [access, match[1]] as const;
  }
  return ['control', undefined] as const;
}
export function authorize(
  req: HonoRequest,
  origin: string,
  token: string,
  store: Store,
) {
  const from = req.header('origin');
  ensure(
    !from || from === origin,
    'Cross-origin control requests are forbidden',
    'FORBIDDEN',
    403,
  );
  const [access, session] = accessOf(req.path);
  if (access === 'none') return;
  const control = equal(req.header('authorization'), `Bearer ${token}`);
  if (session === undefined)
    ensure(control, 'Unauthorized', 'UNAUTHORIZED', 401);
  else {
    let sessionKey: string | undefined;
    try {
      sessionKey = store.get(session).sessionKey;
    } catch (error) {
      // Without the control token, an unknown session looks like a wrong key.
      const unknown = error instanceof Failure && error.code === 'NOT_FOUND';
      if (control || !unknown) throw error;
    }
    ensure(
      control ||
        (sessionKey !== undefined &&
          equal(req.header(SESSION_HEADER), sessionKey)),
      'Unauthorized',
      'UNAUTHORIZED',
      401,
    );
    ensure(
      control || access !== 'agent',
      'This operation requires the control token',
      'UNAUTHORIZED',
      401,
    );
  }
  // Hono dispatches HEAD through GET, but control routes do not allow it.
  if (req.method === 'HEAD')
    throw new Failure(
      404,
      'NOT_FOUND',
      session ? 'Unknown session operation' : 'Not found',
    );
}
