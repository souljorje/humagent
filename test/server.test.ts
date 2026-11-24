import { test, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createServer } from '../dist/server/server.js';
import { Store } from '../dist/server/store.js';
import { sourceOf, safeFile } from '../dist/server/pages.js';
import { LIMITS } from '../dist/shared/feedback.js';
import { fixture } from './fixtures.ts';

const dir = fixture('server');
const root = path.join(dir, 'artifacts');
fs.mkdirSync(root);
let runtime: Awaited<ReturnType<typeof createServer>>;
let sources = 0;

beforeAll(async () => {
  runtime = await createServer({ directory: path.join(dir, 'state') });
});
afterAll(async () => {
  await runtime?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Call a control route in process. The agent credential applies unless `headers` replace it.
 * `body` replaces the JSON text of `data`.
 */
async function call(
  route: string,
  method = 'GET',
  data?: unknown,
  headers: Record<string, string> = {},
  body = data === undefined ? undefined : JSON.stringify(data),
) {
  const response = await runtime.app.request(runtime.origin + route, {
    method,
    headers: {
      host: new URL(runtime.origin).host,
      authorization: `Bearer ${runtime.token}`,
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
  return { status: response.status, data: await response.json() };
}

/** Open a new HTML file. `key` holds the headers that its browser page sends. */
async function open() {
  const source = path.join(root, `source-${++sources}.html`);
  fs.writeFileSync(source, '<!doctype html><h1>Original</h1>');
  const { status, data } = await call('/api/open', 'POST', { source });
  assert.equal(status, 200);
  return {
    source,
    base: `/api/sessions/${data.session}`,
    key: {
      authorization: '',
      'x-humagent-session': new URL(data.url).hash.slice(1),
    },
  };
}

test('control routes refuse foreign origins, missing credentials, session keys outside their session, and unsafe sources', async () => {
  const first = await open();
  const second = await open();
  const status = async (...args: Parameters<typeof call>) =>
    (await call(...args)).status;
  assert.equal(
    await status('/health', 'GET', undefined, {
      origin: 'https://evil.example',
    }),
    403,
  );
  assert.equal(
    await status('/api/sessions', 'GET', undefined, { authorization: '' }),
    401,
  );
  assert.equal(await status(first.base, 'GET', undefined, first.key), 200);
  // A session key reads its own session only. Agent routes need the agent credential.
  for (const [route, data] of [
    [second.base],
    ['/api/sessions'],
    [`${first.base}/wait`, {}],
    [`${first.base}/complete`, {}],
    ['/api/open', { source: second.source }],
  ] as [string, unknown?][])
    assert.equal(
      await status(route, data ? 'POST' : 'GET', data, first.key),
      401,
      route,
    );
  for (const source of [
    'https://localhost:3000',
    'http://example.com',
    'http://user:secret@localhost:3000',
  ])
    assert.equal(await status('/api/open', 'POST', { source }), 400, source);
});

test('the server refuses a stale revision and a receipt from another session', async () => {
  const first = await open();
  const second = await open();
  const { revision } = (await call(first.base)).data;
  const pending = call(`${first.base}/wait`, 'POST', {});
  for (
    let attempt = 0;
    (await call(first.base)).data.agent !== 'connected';
    attempt++
  ) {
    assert.ok(attempt < 200, 'Agent must start waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await call(`${first.base}/instruction`, 'PUT', {
    instruction: 'Check this',
  });
  const send = () => call(`${first.base}/send`, 'POST', { revision });
  assert.equal((await send()).status, 200);
  const batch = (await pending).data;
  assert.equal(batch.status, 'feedback');
  assert.deepEqual(batch.source, { kind: 'file', value: first.source });
  assert.equal(batch.feedback[0].revision, revision);

  const ack = (base: string) =>
    call(`${base}/complete`, 'POST', { receipt: batch.receipt });
  assert.equal((await ack(second.base)).data.error, 'STALE_RECEIPT');
  const reviews = `${first.base}/reviews`;
  const save = (revision: string) =>
    call(reviews, 'POST', {
      revision,
      key: 'options',
      review: { kind: 'form', data: {} },
    });
  const { reviewId } = (await save(revision)).data;
  fs.writeFileSync(first.source, '<!doctype html><h1>Changed</h1>');
  await call(`${first.base}/instruction`, 'PUT', {
    instruction: 'Sent too late',
  });
  assert.equal((await send()).data.error, 'STALE_REVISION');
  const next = (await call(first.base)).data.revision;
  assert.equal((await save(next)).data.reviewId, reviewId);
  assert.equal(
    (await call(`${reviews}/${reviewId}?revision=${revision}`, 'DELETE')).data
      .error,
    'STALE_REVISION',
  );
  assert.equal(
    (await call(`${reviews}/${reviewId}?revision=${next}`, 'DELETE')).status,
    200,
  );
  assert.equal((await ack(first.base)).status, 200);
});

test('file serving refuses non-HTML sources, hidden files, traversal, and symlink escapes', async () => {
  const page = path.join(root, 'page.html');
  fs.writeFileSync(page, '<!doctype html><h1>Page</h1>');
  assert.equal(await safeFile(root, '/page.html'), page);
  fs.writeFileSync(path.join(root, 'app.js'), 'window.works = true;');
  await assert.rejects(() => sourceOf(path.join(root, 'app.js')), /HTML/);
  fs.writeFileSync(path.join(root, '.secret'), 'no');
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'no');
  fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(root, 'escape.txt'));
  for (const request of ['/.secret', '/%2e%2e/outside.txt', '/escape.txt'])
    await assert.rejects(() => safeFile(root, request), request);
});

test('JSON requests enforce content type, syntax, object shape, review rules, and the byte limit', async () => {
  const error = async (...args: Parameters<typeof call>) => {
    const { status, data } = await call(...args);
    return `${status} ${data.error}`;
  };
  assert.equal(
    await error('/api/open', 'POST', {}, { 'content-type': 'text/plain' }),
    '415 CONTENT_TYPE',
  );
  for (const [body, expected] of [
    ['{', '400 INVALID_JSON'],
    ['', '400 INVALID_JSON'],
    ['[]', '400 INVALID_INPUT'],
    ['{"__proto__":{"x":1}}', '400 INVALID_INPUT'],
    ['['.repeat(30) + ']'.repeat(30), '400 INVALID_INPUT'],
  ])
    assert.equal(
      await error('/api/open', 'POST', undefined, {}, body),
      expected,
      body,
    );

  const { base } = await open();
  const { revision } = (await call(base)).data;
  // The server checks the envelope only. The workspace applies the rules of each kind.
  for (const review of [
    { target: { selector: 'h1' }, comment: 'x' },
    { kind: 'Not a kind', target: { selector: 'h1' }, comment: 'x' },
    { kind: 'comment', target: { selector: 'h1' }, comment: 'x', edit: {} },
    { kind: 'comment', comment: ' ' },
    {
      kind: 'comment',
      target: { selector: 'h1' },
      comment: 'a'.repeat(LIMITS.comment + 1),
    },
    { kind: 'comment', target: 'h1', comment: 'x' },
  ])
    assert.equal(
      await error(`${base}/reviews`, 'POST', { revision, review }),
      '400 INVALID_INPUT',
      JSON.stringify(review).slice(0, 80),
    );
  assert.equal((await call(base)).data.pending.length, 0);

  // An ended session answers a wait at once, so the wait route can take padded bodies.
  await call(`${base}/end`, 'POST', {});
  const padded = (padding: string) => JSON.stringify({ padding });
  const atLimit = padded('x'.repeat(LIMITS.bodyBytes - padded('').length));
  assert.equal(Buffer.byteLength(atLimit), LIMITS.bodyBytes);
  const accepted = await call(`${base}/wait`, 'POST', undefined, {}, atLimit);
  assert.equal(accepted.data.status, 'ended');
  // Fewer characters than the limit, but more bytes.
  const tooLarge = padded('🧪'.repeat(LIMITS.bodyBytes / 4));
  assert.ok(tooLarge.length < LIMITS.bodyBytes);
  assert.equal(
    await error(`${base}/wait`, 'POST', undefined, {}, tooLarge),
    '413 TOO_LARGE',
  );
});

test('the store carries a new kind of review without a transport change', async () => {
  const store = new Store(path.join(dir, 'kinds'));
  const source = path.join(root, 'kinds.html');
  fs.writeFileSync(source, '<!doctype html><h1>Kinds</h1>');
  const { id } = store.open(await sourceOf(source), 'r1');
  const save = (review: object, extra: object = {}) =>
    store.addReview(id, { revision: 'r1', review, ...extra });
  // No plugin defines `flag`: a targeted kind without data.
  const flagged = (selector: string) =>
    save({ kind: 'flag', target: { selector } }, { key: 'only' });
  const first = flagged('h1');
  save({ kind: 'comment', comment: 'Second', target: { selector: 'p' } });
  // A keyed replacement keeps the review ID and the list position.
  assert.equal(flagged('h2'), first);
  const expected = [
    { id: first, kind: 'flag', target: { selector: 'h2' } },
    { kind: 'comment', comment: 'Second', target: { selector: 'p' } },
  ];
  assert.partialDeepStrictEqual(
    store.get(id).pending.map((saved) => saved.review),
    expected,
  );
  store.send(id, 'r1');
  const delivered = store.take(id);
  assert.ok(delivered && delivered.status === 'feedback');
  assert.partialDeepStrictEqual(delivered.feedback[0]!.reviews, expected);
});

test('the server refuses a foreign Host header and a second writer on its state directory', async () => {
  const { host, port } = new URL(runtime.origin);
  const health = (name: string) =>
    new Promise<number>((resolve, reject) =>
      http
        .get(`${runtime.origin}/health`, { headers: { host: name } }, (res) => {
          res.resume();
          resolve(res.statusCode!);
        })
        .on('error', reject),
    );
  assert.equal(await health(host), 200);
  for (const name of [
    'evil.example',
    `localhost:${port}`,
    `evil.example:${port}`,
  ])
    assert.equal(await health(name), 403, name);
  await assert.rejects(
    () => createServer({ directory: path.join(dir, 'state') }),
    /Another server/,
  );
});
