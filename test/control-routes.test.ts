import { test, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRuntime } from '../dist/runtime/server.js';
import { LIMITS } from '../dist/shared/feedback.js';
import { fixture } from './fixtures.ts';

const dir = fixture('control-routes');
const root = path.join(dir, 'artifacts');
fs.mkdirSync(root);
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let targetNumber = 0;

beforeAll(async () => {
  runtime = await createRuntime({ directory: path.join(dir, 'state') });
});

afterAll(async () => {
  await runtime?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function request(
  route: string,
  {
    method = 'GET',
    headers = {},
    body,
  }: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit;
  } = {},
) {
  return runtime.app.request(runtime.origin + route, {
    method,
    headers: {
      host: new URL(runtime.origin).host,
      authorization: `Bearer ${runtime.token}`,
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}

function jsonRequest(
  route: string,
  method: string,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return request(route, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(data),
  });
}

async function json(response: Response, status: number, error?: string) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type')!, /^application\/json\b/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const value = await response.json();
  if (error) assert.equal(value.error, error);
  return value;
}

async function open() {
  const target = path.join(root, `target-${++targetNumber}.html`);
  fs.writeFileSync(target, '<!doctype html><h1>Original</h1>');
  const session = await json(
    await jsonRequest('/api/open', 'POST', { target }),
    200,
  );
  return { ...session, targetPath: target };
}

function chunks(value: string, size = 4096) {
  const bytes = new TextEncoder().encode(value);
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += size)
        controller.enqueue(bytes.slice(offset, offset + size));
      controller.close();
    },
  });
}

test('control routes enforce origin and credential boundaries', async () => {
  const first = await open();
  const second = await open();
  const key = new URL(first.url).hash.slice(1);
  const sessionHeaders = {
    authorization: '',
    'x-humagent-session': key,
  };
  for (const origin of [
    'https://evil.example',
    'null',
    'http://127.0.0.1:1',
  ] as const)
    await json(
      await request('/health', { headers: { origin } }),
      403,
      'FORBIDDEN',
    );
  await json(
    await request('/health', {
      headers: { origin: runtime.origin, authorization: '' },
    }),
    200,
  );
  await json(
    await request('/api/sessions', { headers: { authorization: '' } }),
    401,
    'UNAUTHORIZED',
  );
  await json(
    await request('/api/sessions', { headers: sessionHeaders }),
    401,
    'UNAUTHORIZED',
  );
  await json(
    await jsonRequest(
      '/api/open',
      'POST',
      { target: first.targetPath },
      sessionHeaders,
    ),
    401,
    'UNAUTHORIZED',
  );
  await json(
    await request(`/api/sessions/${second.session}`, {
      headers: sessionHeaders,
    }),
    401,
    'UNAUTHORIZED',
  );
  for (const headers of [
    sessionHeaders,
    { ...sessionHeaders, 'x-humagent-session': '' },
  ])
    await json(
      await request('/api/sessions/missing-session', { headers }),
      401,
      'UNAUTHORIZED',
    );
  const snapshot = await json(
    await request(`/api/sessions/${first.session}`, {
      headers: sessionHeaders,
    }),
    200,
  );
  assert.equal(snapshot.target.value, first.targetPath);
  assert.equal(typeof snapshot.revision, 'string');
  assert.equal('viewKey' in snapshot, false);
  assert.equal('delivery' in snapshot, false);
  assert.equal('acknowledged' in snapshot, false);
  for (const action of ['wait', 'ack'] as const)
    await json(
      await jsonRequest(
        `/api/sessions/${first.session}/${action}`,
        'POST',
        {},
        sessionHeaders,
      ),
      401,
      'UNAUTHORIZED',
    );
  const form = {
    revision: snapshot.revision,
    key: 'plan form',
    item: { intent: 'review', values: { selection: 'first' } },
  };
  await json(
    await jsonRequest(
      `/api/sessions/${first.session}/drafts`,
      'POST',
      form,
      sessionHeaders,
    ),
    200,
  );
  const forms = await json(
    await jsonRequest(
      `/api/sessions/${first.session}/drafts`,
      'POST',
      { ...form, item: { intent: 'review', values: { selection: 'second' } } },
      sessionHeaders,
    ),
    200,
  );
  assert.deepEqual(
    forms.session.drafts.map(
      (draft: { item: { values: unknown } }) => draft.item.values,
    ),
    [{ selection: 'second' }],
  );
  const draft = await json(
    await jsonRequest(
      `/api/sessions/${first.session}/drafts`,
      'POST',
      {
        revision: snapshot.revision,
        item: { target: { selector: 'h1' }, comment: 'Check this' },
      },
      sessionHeaders,
    ),
    200,
  );
  await json(
    await request(`/api/sessions/${first.session}/drafts/${draft.draftId}`, {
      method: 'DELETE',
      headers: sessionHeaders,
    }),
    200,
  );
  await json(
    await jsonRequest(
      `/api/sessions/${first.session}/send`,
      'POST',
      { revision: snapshot.revision },
      sessionHeaders,
    ),
    409,
    'AGENT_UNAVAILABLE',
  );
  const ended = await json(
    await jsonRequest(
      `/api/sessions/${first.session}/end`,
      'POST',
      {},
      sessionHeaders,
    ),
    200,
  );
  assert.equal(ended.session.ended, true);
});

test('control routes return the expected content and method errors', async () => {
  const health = await json(await request('/health'), 200);
  assert.equal(health.app, 'humagent');
  for (const [route, type] of [
    ['/', /^text\/html/],
    ['/ui/app.js', /^text\/javascript/],
    ['/ui/app.css', /^text\/css/],
  ] as const) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, type);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await response.text()).length > 0);
  }
  await json(await request('/', { method: 'POST' }), 405, 'METHOD');
  const session = await open();
  for (const [route, method] of [
    ['/unknown', 'GET'],
    ['/api/open', 'GET'],
    ['/api/sessions', 'POST'],
    [`/api/sessions/${session.session}`, 'POST'],
    [`/api/sessions/${session.session}/send`, 'GET'],
    [`/api/sessions/${session.session}/drafts/missing`, 'GET'],
    [`/api/sessions/${session.session}/unknown`, 'GET'],
    ['/api/sessions/missing', 'GET'],
  ] as const)
    await json(await request(route, { method }), 404, 'NOT_FOUND');
  const listing = await json(await request('/api/sessions'), 200);
  assert.ok(
    listing.sessions.some(
      (entry: { id: string }) => entry.id === session.session,
    ),
  );
  assert.ok(Array.isArray(listing.errors));
});

test('HEAD retains route-specific methods after authentication', async () => {
  const session = await open();
  const sessionHeaders = {
    authorization: '',
    'x-humagent-session': new URL(session.url).hash.slice(1),
  };
  for (const [route, status, headers] of [
    ['/health', 200, {}],
    ['/', 405, {}],
    ['/api/sessions', 404, {}],
    [`/api/sessions/${session.session}`, 404, {}],
    [`/api/sessions/${session.session}/send`, 404, {}],
    [`/api/sessions/${session.session}`, 404, sessionHeaders],
    [`/api/sessions/${session.session}/send`, 404, sessionHeaders],
    ['/api/sessions', 401, { authorization: '' }],
    [`/api/sessions/${session.session}`, 401, { authorization: '' }],
  ] as const) {
    const response = await request(route, { method: 'HEAD', headers });
    assert.equal(response.status, status, `HEAD ${route}`);
    assert.match(response.headers.get('content-type')!, /^application\/json\b/);
    assert.equal(await response.text(), '');
  }
});

test('JSON requests enforce content type, syntax, object shape, and streamed byte limits', async () => {
  for (const headers of [{}, { 'content-type': 'text/plain' }] as Record<
    string,
    string
  >[])
    await json(
      await request('/api/open', { method: 'POST', headers, body: '{}' }),
      415,
      'CONTENT_TYPE',
    );
  for (const [body, error] of [
    ['{', 'INVALID_JSON'],
    ['', 'INVALID_JSON'],
    ['[]', 'INVALID_INPUT'],
    ['null', 'INVALID_INPUT'],
  ] as const)
    await json(
      await request('/api/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      400,
      error,
    );
  const session = await open();
  const route = `/api/sessions/${session.session}/wait`;
  // An ended session answers a wait at once.
  await json(
    await jsonRequest(`/api/sessions/${session.session}/end`, 'POST', {}),
    200,
  );
  const prefix = '{"padding":"';
  const suffix = '"}';
  const atLimit =
    prefix +
    'x'.repeat(LIMITS.bodyBytes - prefix.length - suffix.length) +
    suffix;
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  assert.equal(Buffer.byteLength(atLimit), LIMITS.bodyBytes);
  const accepted = await json(
    await request(route, { method: 'POST', headers, body: chunks(atLimit) }),
    200,
  );
  assert.equal(accepted.status, 'ended');
  const tooLarge = prefix + '🧪'.repeat(LIMITS.bodyBytes / 4) + suffix;
  assert.ok(Buffer.byteLength(tooLarge) > LIMITS.bodyBytes);
  await json(
    await request(route, { method: 'POST', headers, body: tooLarge }),
    413,
    'TOO_LARGE',
  );
  await json(
    await request(route, {
      method: 'POST',
      headers,
      body: chunks(tooLarge, 1023),
    }),
    413,
    'TOO_LARGE',
  );
});

test('route receipts preserve target, revision, and individual event ownership', async () => {
  const first = await open();
  const second = await open();
  const base = `/api/sessions/${first.session}`;
  const other = `/api/sessions/${second.session}`;
  const view = await json(await request(base), 200);
  const otherView = await json(await request(other), 200);
  async function queue(path: string, revision: string) {
    await json(
      await jsonRequest(`${path}/drafts`, 'POST', {
        revision,
        item: { comment: 'Review this', target: { selector: 'h1' } },
      }),
      200,
    );
    return (
      await json(await jsonRequest(`${path}/send`, 'POST', { revision }), 200)
    ).event;
  }
  async function listen(path: string) {
    const pending = jsonRequest(`${path}/wait`, 'POST', {});
    for (
      let attempt = 0;
      (await json(await request(path), 200)).agent !== 'waiting';
      attempt++
    ) {
      assert.ok(attempt < 100, 'Agent must start waiting');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { pending };
  }
  const firstWait = await listen(base);
  const sent = await queue(base, view.revision);
  assert.deepEqual(sent.items[0].target, { selector: 'h1' });
  await json(
    await jsonRequest(`${base}/send`, 'POST', { revision: view.revision }),
    400,
    'INVALID_INPUT',
  );
  const otherWait = await listen(other);
  const otherEvent = await queue(other, otherView.revision);
  await otherWait.pending;
  assert.notEqual(otherEvent.id, sent.id);
  const batch = await json(await firstWait.pending, 200);
  assert.equal(batch.status, 'feedback');
  assert.equal(batch.session, first.session);
  assert.equal(batch.target.value, first.targetPath);
  assert.equal(batch.events[0].id, sent.id);
  assert.equal(batch.events[0].revision, view.revision);
  const again = await json(await jsonRequest(`${base}/wait`, 'POST', {}), 200);
  assert.deepEqual(
    again.events.map((event: { id: string }) => event.id),
    [sent.id],
  );
  assert.notEqual(again.receipt, batch.receipt);
  for (const path of [base, other])
    await json(
      await jsonRequest(`${path}/ack`, 'POST', { receipt: batch.receipt }),
      409,
      'STALE_RECEIPT',
    );
  fs.writeFileSync(first.targetPath, '<!doctype html><h1>Changed</h1>');
  await json(
    await jsonRequest(`${base}/message`, 'PUT', { text: 'Seen before?' }),
    200,
  );
  await json(
    await jsonRequest(`${base}/send`, 'POST', { revision: view.revision }),
    409,
    'STALE_REVISION',
  );
  const changed = await json(await request(base), 200);
  assert.notEqual(changed.revision, view.revision);
  const newer = await queue(base, changed.revision);
  assert.equal(newer.message, 'Seen before?');
  const acknowledgment = { receipt: again.receipt };
  await json(await jsonRequest(`${base}/ack`, 'POST', acknowledgment), 200);
  await json(await jsonRequest(`${base}/ack`, 'POST', acknowledgment), 200);
  assert.equal((await json(await request(other), 200)).agent, 'working');
  await json(await jsonRequest(`${base}/end`, 'POST', {}), 200);
  const last = await json(await jsonRequest(`${base}/wait`, 'POST', {}), 200);
  assert.deepEqual(
    last.events.map((event: { id: string }) => event.id),
    [newer.id],
  );
  await json(
    await jsonRequest(`${base}/ack`, 'POST', { receipt: last.receipt }),
    200,
  );
  assert.equal(
    (await json(await jsonRequest(`${base}/wait`, 'POST', {}), 200)).status,
    'ended',
  );
  await json(
    await jsonRequest(`${base}/drafts`, 'POST', {
      revision: changed.revision,
      item: { comment: 'Late', target: { selector: 'h1' } },
    }),
    410,
    'ENDED',
  );
});
