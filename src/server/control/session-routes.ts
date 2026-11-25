/** Operations on one session. `access.ts` decides who can use each one. */
import type { Hono } from 'hono';
import type { WorkspaceView } from '../../shared/feedback.js';
import { ensure } from '../../shared/validate.js';
import type { PageServer } from '../pages/page-server.js';
import type { Store } from '../sessions/store.js';
import { body, json } from './http.js';
import { waitResponse } from './wait.js';

export const sessionPath = '/api/sessions/:id{[\\w-]+}';
export function registerSessionActions(
  app: Hono,
  store: Store,
  pageServer: (id: string) => Promise<PageServer>,
  snapshot: (id: string) => Promise<WorkspaceView>,
) {
  /** Workspace writes return the fresh session, so the browser never guesses the result. */
  const reply = async (id: string, extra: object = {}) =>
    json(200, { ...extra, session: await snapshot(id) });
  app.post(`${sessionPath}/reviews`, async (c) => {
    const id = c.req.param('id');
    const reviewId = store.addReview(id, await body(c.req.raw));
    return reply(id, { reviewId });
  });
  app.patch(`${sessionPath}/reviews/:review`, async (c) => {
    const id = c.req.param('id');
    store.editReview(id, c.req.param('review'), await body(c.req.raw));
    return reply(id);
  });
  app.delete(`${sessionPath}/reviews/:review`, async (c) => {
    const id = c.req.param('id');
    store.removeReview(id, c.req.param('review'), c.req.query('revision'));
    return reply(id);
  });
  app.put(`${sessionPath}/instruction`, async (c) => {
    const id = c.req.param('id');
    store.setInstruction(id, (await body(c.req.raw)).instruction);
    return reply(id);
  });
  app.post(`${sessionPath}/send`, async (c) => {
    const id = c.req.param('id');
    const value = await body(c.req.raw);
    await (await pageServer(id)).checkRevision();
    ensure(
      store.get(id).ended || store.view(id).agent !== 'idle',
      'Connect an agent before sending feedback.',
      'AGENT_UNAVAILABLE',
      409,
    );
    const feedback = store.send(id, value.revision);
    return reply(id, { feedback });
  });
  app.post(`${sessionPath}/page`, async (c) => {
    const id = c.req.param('id');
    const value = await body(c.req.raw);
    (await pageServer(id)).activate(value.documentId);
    return reply(id);
  });
  app.post(`${sessionPath}/end`, async (c) => {
    const id = c.req.param('id');
    await body(c.req.raw);
    store.end(id);
    return reply(id);
  });
  app.post(`${sessionPath}/complete`, async (c) => {
    const id = c.req.param('id');
    store.complete(id, (await body(c.req.raw)).receipt);
    return json(200, store.view(id));
  });
  app.post(`${sessionPath}/wait`, async (c) => {
    await body(c.req.raw);
    const id = c.req.param('id');
    return waitResponse(c.req.raw, store, id);
  });
}
