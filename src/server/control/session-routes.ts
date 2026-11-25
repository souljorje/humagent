/** Operations on one session. `access.ts` decides who can use each one. */
import type { Hono } from 'hono';
import { ensure } from '@/shared/validate';
import { pageServer, snapshot, type Runtime } from '@/server/runtime';
import { body, json } from './http';
import { waitResponse } from './wait';

export const sessionPath = '/api/sessions/:id{[\\w-]+}';

/** Workspace writes return the fresh session, so the browser never guesses the result. */
async function reply(runtime: Runtime, id: string, extra: object = {}) {
  return json(200, { ...extra, session: await snapshot(runtime, id) });
}

async function addReview(runtime: Runtime, id: string, request: Request) {
  const reviewId = runtime.store.addReview(id, await body(request));
  return reply(runtime, id, { reviewId });
}

async function editReview(
  runtime: Runtime,
  id: string,
  reviewId: string,
  request: Request,
) {
  runtime.store.editReview(id, reviewId, await body(request));
  return reply(runtime, id);
}

async function removeReview(
  runtime: Runtime,
  id: string,
  reviewId: string,
  revision: string | undefined,
) {
  runtime.store.removeReview(id, reviewId, revision);
  return reply(runtime, id);
}

async function setInstruction(runtime: Runtime, id: string, request: Request) {
  runtime.store.setInstruction(id, (await body(request)).instruction);
  return reply(runtime, id);
}

async function send(runtime: Runtime, id: string, request: Request) {
  const { store } = runtime;
  const { revision } = await body(request);
  const page = await pageServer(runtime, id);
  await page.checkRevision();
  const { ended, agent } = store.view(id);
  ensure(
    ended || agent !== 'idle',
    'Connect an agent before sending feedback.',
    'AGENT_UNAVAILABLE',
    409,
  );
  return reply(runtime, id, { feedback: store.send(id, revision) });
}

async function attachPage(runtime: Runtime, id: string, request: Request) {
  const { documentId } = await body(request);
  const page = await pageServer(runtime, id);
  page.activate(documentId);
  return reply(runtime, id);
}

async function end(runtime: Runtime, id: string, request: Request) {
  await body(request);
  runtime.store.end(id);
  return reply(runtime, id);
}

async function complete({ store }: Runtime, id: string, request: Request) {
  store.complete(id, (await body(request)).receipt);
  return json(200, store.view(id));
}

async function wait({ store }: Runtime, id: string, request: Request) {
  await body(request);
  return waitResponse(request, store, id);
}

export function registerSessionActions(app: Hono, runtime: Runtime) {
  app.post(`${sessionPath}/reviews`, ({ req }) =>
    addReview(runtime, req.param('id'), req.raw),
  );
  app.patch(`${sessionPath}/reviews/:review`, ({ req }) =>
    editReview(runtime, req.param('id'), req.param('review'), req.raw),
  );
  app.delete(`${sessionPath}/reviews/:review`, ({ req }) =>
    removeReview(
      runtime,
      req.param('id'),
      req.param('review'),
      req.query('revision'),
    ),
  );
  app.put(`${sessionPath}/instruction`, ({ req }) =>
    setInstruction(runtime, req.param('id'), req.raw),
  );
  app.post(`${sessionPath}/send`, ({ req }) =>
    send(runtime, req.param('id'), req.raw),
  );
  app.post(`${sessionPath}/page`, ({ req }) =>
    attachPage(runtime, req.param('id'), req.raw),
  );
  app.post(`${sessionPath}/end`, ({ req }) =>
    end(runtime, req.param('id'), req.raw),
  );
  app.post(`${sessionPath}/complete`, ({ req }) =>
    complete(runtime, req.param('id'), req.raw),
  );
  app.post(`${sessionPath}/wait`, ({ req }) =>
    wait(runtime, req.param('id'), req.raw),
  );
}
