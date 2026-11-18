import { test, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRuntime } from '../dist/runtime/server.js';
import { targetOf, safeFile } from '../dist/runtime/surfaces.js';
import { LIMITS } from '../dist/shared/feedback.js';
import { fixture } from './fixtures.ts';

const dir = fixture('server');
const root = path.join(dir, 'artifacts');
fs.mkdirSync(root);
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let targets = 0;

beforeAll(async () => {
  runtime = await createRuntime({ directory: path.join(dir, 'state') });
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
  const target = path.join(root, `target-${++targets}.html`);
  fs.writeFileSync(target, '<!doctype html><h1>Original</h1>');
  const { status, data } = await call('/api/open', 'POST', { target });
  assert.equal(status, 200);
  return {
    target,
    base: `/api/sessions/${data.session}`,
    key: {
      authorization: '',
      'x-humagent-session': new URL(data.url).hash.slice(1),
    },
  };
}

test('control routes refuse foreign origins, missing credentials, session keys outside their session, and unsafe targets', async () => {
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
    [`${first.base}/ack`, {}],
    ['/api/open', { target: second.target }],
  ] as [string, unknown?][])
    assert.equal(
      await status(route, data ? 'POST' : 'GET', data, first.key),
      401,
      route,
    );
  for (const target of [
    'https://localhost:3000',
    'http://example.com',
    'http://user:secret@localhost:3000',
  ])
    assert.equal(await status('/api/open', 'POST', { target }), 400, target);
});

test('the server refuses a stale revision and a receipt from another session', async () => {
  const first = await open();
  const second = await open();
  const { revision } = (await call(first.base)).data;
  const pending = call(`${first.base}/wait`, 'POST', {});
  for (
    let attempt = 0;
    (await call(first.base)).data.agent !== 'waiting';
    attempt++
  ) {
    assert.ok(attempt < 200, 'Agent must start waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await call(`${first.base}/message`, 'PUT', { text: 'Review this' });
  const send = () => call(`${first.base}/send`, 'POST', { revision });
  assert.equal((await send()).status, 200);
  const batch = (await pending).data;
  assert.equal(batch.status, 'feedback');
  assert.deepEqual(batch.target, { kind: 'file', value: first.target });
  assert.equal(batch.events[0].revision, revision);

  const ack = (base: string) =>
    call(`${base}/ack`, 'POST', { receipt: batch.receipt });
  assert.equal((await ack(second.base)).data.error, 'STALE_RECEIPT');
  fs.writeFileSync(first.target, '<!doctype html><h1>Changed</h1>');
  await call(`${first.base}/message`, 'PUT', { text: 'Sent too late' });
  assert.equal((await send()).data.error, 'STALE_REVISION');
  assert.equal((await ack(first.base)).status, 200);
});

test('file serving refuses non-HTML targets, hidden files, traversal, and symlink escapes', async () => {
  const page = path.join(root, 'page.html');
  fs.writeFileSync(page, '<!doctype html><h1>Page</h1>');
  assert.equal(await safeFile(root, '/page.html'), page);
  fs.writeFileSync(path.join(root, 'app.js'), 'window.works = true;');
  await assert.rejects(() => targetOf(path.join(root, 'app.js')), /HTML/);
  fs.writeFileSync(path.join(root, '.secret'), 'no');
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'no');
  fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(root, 'escape.txt'));
  for (const request of ['/.secret', '/%2e%2e/outside.txt', '/escape.txt'])
    await assert.rejects(() => safeFile(root, request), request);
});

test('JSON requests enforce content type, syntax, object shape, item rules, and the byte limit', async () => {
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
  for (const item of [
    { target: { selector: 'h1' }, comment: 'x', kind: 'execute' },
    { target: { selector: 'h1' }, comment: ' ' },
    { target: { selector: 'h1' }, comment: 'a'.repeat(LIMITS.comment + 1) },
    { replacement: { before: 'a', after: 'b' } },
    { values: 'x' },
    { target: { selector: 'h1' }, values: {} },
  ])
    assert.equal(
      await error(`${base}/drafts`, 'POST', { revision, item }),
      '400 INVALID_INPUT',
      JSON.stringify(item).slice(0, 80),
    );
  assert.equal((await call(base)).data.drafts.length, 0);

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
    () => createRuntime({ directory: path.join(dir, 'state') }),
    /Another server/,
  );
});
