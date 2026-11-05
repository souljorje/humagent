import { test, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRuntime } from '../dist/runtime/server.js';
import { MAX_BYTES } from '../dist/runtime/protocol.js';
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

test('control routes enforce host, origin, and credential boundaries', async () => {
  const first = await open();
  const second = await open();
  const key = new URL(first.url).hash.slice(1);
  const sessionHeaders = {
    authorization: '',
    'x-humagent-session': key,
  };
  for (const host of ['', 'evil.example', 'localhost:1234'] as const)
    await json(
      await request('/health', { headers: { host } }),
      403,
      'FORBIDDEN',
    );
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
  const snapshot = await json(
    await request(`/api/sessions/${first.session}`, {
      headers: sessionHeaders,
    }),
    200,
  );
  assert.equal(snapshot.target.value, first.targetPath);
  assert.equal(typeof snapshot.revision, 'string');
  assert.equal('viewKey' in snapshot, false);
  assert.equal('lease' in snapshot, false);
  assert.equal('acknowledged' in snapshot, false);
  for (const action of ['wait', 'ack', 'reply', 'renew'] as const)
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
  const state = await json(
    await jsonRequest(
      `/api/sessions/${first.session}/state`,
      'PUT',
      { expectedVersion: 0, state: { selection: 'first' } },
      sessionHeaders,
    ),
    200,
  );
  assert.equal(state.stateVersion, 1);
  assert.deepEqual(state.state, { selection: 'first' });
  await json(
    await jsonRequest(
      `/api/sessions/${first.session}/state`,
      'PUT',
      { expectedVersion: 0, state: { selection: 'stale' } },
      sessionHeaders,
    ),
    409,
    'STATE_CONFLICT',
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
  assert.equal(ended.ended, true);
});

test('control routes return the expected content and method errors', async () => {
  const health = await json(await request('/health'), 200);
  assert.equal(health.app, 'humagent');
  assert.equal(health.protocol, 1);
  for (const [route, type] of [
    ['/workspace', /^text\/html/],
    ['/app.js', /^text\/javascript/],
    ['/app.css', /^text\/css/],
  ] as const) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, type);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await response.text()).length > 0);
    await json(await request(route, { method: 'POST' }), 405, 'METHOD');
  }
  const session = await open();
  for (const [route, method] of [
    ['/unknown', 'GET'],
    ['/api/open', 'GET'],
    ['/api/sessions', 'POST'],
    [`/api/sessions/${session.session}`, 'POST'],
    [`/api/sessions/${session.session}/events`, 'GET'],
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
    ['/workspace', 405, {}],
    ['/api/sessions', 404, {}],
    [`/api/sessions/${session.session}`, 404, {}],
    [`/api/sessions/${session.session}/stream`, 404, {}],
    [`/api/sessions/${session.session}`, 404, sessionHeaders],
    [`/api/sessions/${session.session}/stream`, 404, sessionHeaders],
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
  const prefix = '{"timeoutMs":1,"padding":"';
  const suffix = '"}';
  const atLimit =
    prefix + 'x'.repeat(MAX_BYTES - prefix.length - suffix.length) + suffix;
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  assert.equal(Buffer.byteLength(atLimit), MAX_BYTES);
  const accepted = await json(
    await request(route, { method: 'POST', headers, body: chunks(atLimit) }),
    200,
  );
  assert.equal(accepted.status, 'timeout');
  const tooLarge = prefix + '🧪'.repeat(MAX_BYTES / 4) + suffix;
  assert.ok(Buffer.byteLength(tooLarge) > MAX_BYTES);
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
  const event = {
    protocol: 2,
    clientId: 'same-id',
    revision: view.revision,
    payload: {
      items: [
        { id: 'comment', comment: 'Review this', target: { selector: 'h1' } },
      ],
    },
  };
  const sessionHeaders = {
    authorization: '',
    'x-humagent-session': new URL(first.url).hash.slice(1),
  };
  const sent = await json(
    await jsonRequest(`${base}/events`, 'POST', event, sessionHeaders),
    200,
  );
  assert.deepEqual(sent.payload.items[0].target, { selector: 'h1' });
  assert.equal(
    (await json(await jsonRequest(`${base}/events`, 'POST', event), 200)).id,
    sent.id,
  );
  await json(
    await jsonRequest(`${base}/events`, 'POST', {
      ...event,
      payload: { ...event.payload, text: 'Different' },
    }),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
  const otherEvent = await json(
    await jsonRequest(`${other}/events`, 'POST', {
      ...event,
      revision: otherView.revision,
    }),
    200,
  );
  assert.notEqual(otherEvent.id, sent.id);
  const batch = await json(
    await jsonRequest(`${base}/wait`, 'POST', {
      consumer: 'agent',
      timeoutMs: 100,
    }),
    200,
  );
  assert.equal(batch.status, 'feedback');
  assert.equal(batch.session, first.session);
  assert.equal(batch.target.value, first.targetPath);
  assert.equal(batch.events[0].id, sent.id);
  assert.equal(batch.events[0].revision, view.revision);
  await json(
    await jsonRequest(`${base}/wait`, 'POST', {
      consumer: 'other',
      timeoutMs: 100,
    }),
    409,
    'LEASE_ACTIVE',
  );
  await json(
    await jsonRequest(`${other}/ack`, 'POST', { receipt: batch.receipt }),
    409,
    'STALE_RECEIPT',
  );
  await json(
    await jsonRequest(`${base}/renew`, 'POST', {
      receipt: batch.receipt,
      leaseMs: 10000,
    }),
    200,
  );
  fs.writeFileSync(first.targetPath, '<!doctype html><h1>Changed</h1>');
  await json(
    await jsonRequest(`${base}/events`, 'POST', {
      ...event,
      clientId: 'stale',
    }),
    409,
    'STALE_REVISION',
  );
  assert.equal(
    (await json(await jsonRequest(`${base}/events`, 'POST', event), 200)).id,
    sent.id,
  );
  const changed = await json(await request(base), 200);
  assert.notEqual(changed.revision, view.revision);
  const newer = await json(
    await jsonRequest(`${base}/events`, 'POST', {
      ...event,
      clientId: 'newer',
      revision: changed.revision,
    }),
    200,
  );
  const reply = { receipt: batch.receipt, message: 'Applied' };
  await json(await jsonRequest(`${base}/reply`, 'POST', reply), 200);
  await json(await jsonRequest(`${base}/reply`, 'POST', reply), 200);
  await json(
    await jsonRequest(`${base}/reply`, 'POST', {
      ...reply,
      message: 'Different',
    }),
    409,
    'REPLY_CONFLICT',
  );
  const after = await json(await request(base), 200);
  assert.deepEqual(
    after.events.map(({ id, status }: { id: string; status: string }) => ({
      id,
      status,
    })),
    [
      { id: sent.id, status: 'completed' },
      { id: newer.id, status: 'queued' },
    ],
  );
  assert.equal(after.replies.length, 1);
  assert.equal(
    (await json(await request(other), 200)).events[0].status,
    'queued',
  );
  await json(await jsonRequest(`${base}/end`, 'POST', {}), 200);
  const last = await json(
    await jsonRequest(`${base}/wait`, 'POST', { timeoutMs: 100 }),
    200,
  );
  assert.equal(last.events[0].id, newer.id);
  await json(
    await jsonRequest(`${base}/ack`, 'POST', { receipt: last.receipt }),
    200,
  );
  assert.equal(
    (
      await json(
        await jsonRequest(`${base}/wait`, 'POST', { timeoutMs: 100 }),
        200,
      )
    ).status,
    'ended',
  );
  await json(
    await jsonRequest(`${base}/events`, 'POST', {
      ...event,
      clientId: 'ended',
    }),
    410,
    'ENDED',
  );
});
