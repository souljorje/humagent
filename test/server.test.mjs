import { test, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixtures.mjs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRuntime } from '../dist/server.js';
import { targetOf, safeFile } from '../dist/surfaces.js';

const dir = fixture('http');
const root = path.join(dir, 'artifacts');
fs.mkdirSync(root);
const file = path.join(root, 'index.html');
fs.writeFileSync(
  file,
  '<!doctype html><html><body><h1>Hello</h1><script>const literal="</body>";</script></body></html>',
);
fs.writeFileSync(path.join(root, 'app.js'), 'window.works=true;');
let runtime;
beforeAll(async () => {
  runtime = await createRuntime({ directory: path.join(dir, 'state') });
});
afterAll(async () => {
  await runtime.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
async function api(route, method = 'GET', data, headers = {}) {
  const res = await fetch(runtime.origin + route, {
    method,
    headers: {
      authorization: `Bearer ${runtime.token}`,
      'content-type': 'application/json',
      ...headers,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: res.status, data: await res.json() };
}
async function opened() {
  const res = await api('/api/open', 'POST', { target: file });
  assert.equal(res.status, 200);
  return res.data;
}
test('opens isolated local surface and injects before literal body text', async () => {
  const s = await opened();
  const snapshot = (await api(`/api/sessions/${s.session}`)).data;
  const page = await fetch(snapshot.surface.frameUrl, {
    headers: { 'sec-fetch-dest': 'iframe' },
  });
  const html = await page.text();
  assert.match(html, /window.__HUMAGENT__/);
  assert.match(html, /const literal="<\/body>"/);
  assert.ok(snapshot.surface.origin !== runtime.origin);
  assert.ok(!html.includes(runtime.token));
  assert.ok(!html.includes(new URL(s.url).hash.slice(1)));
  assert.match(
    page.headers.get('content-security-policy'),
    /connect-src 'none'/,
  );
  assert.match(
    await (await fetch(snapshot.surface.origin + '/app.js')).text(),
    /works=true/,
  );
});
test('fetching sibling HTML preserves its bytes and the active file revision', async () => {
  const fragment = '<p>Unchanged HTML fragment</p>';
  fs.writeFileSync(path.join(root, 'fragment.html'), fragment);
  const s = await opened();
  const before = (await api(`/api/sessions/${s.session}`)).data;
  for (const headers of [{}, { 'sec-fetch-dest': 'empty' }]) {
    const response = await fetch(before.surface.origin + '/fragment.html', {
      headers,
    });
    assert.equal(await response.text(), fragment);
    const after = (await api(`/api/sessions/${s.session}`)).data;
    assert.equal(after.revision, before.revision);
    assert.equal(after.surface.frameUrl, before.surface.frameUrl);
  }
});
test('session capability cannot invoke privileged operations or other sessions', async () => {
  const s = await opened(),
    key = new URL(s.url).hash.slice(1);
  const headers = { authorization: '', 'x-humagent-session': key };
  assert.equal(
    (await api(`/api/sessions/${s.session}`, 'GET', undefined, headers)).status,
    200,
  );
  assert.equal(
    (await api(`/api/sessions/${s.session}/wait`, 'POST', {}, headers)).status,
    401,
  );
  assert.equal(
    (await api('/api/open', 'POST', { target: file }, headers)).status,
    401,
  );
});
test('rejects hostile origins, host headers, and missing credentials', async () => {
  assert.equal(
    (
      await api('/api/sessions', 'GET', undefined, {
        origin: 'https://evil.example',
      })
    ).status,
    403,
  );
  assert.equal(
    await new Promise((resolve, reject) => {
      const req = http.get(
        runtime.origin + '/api/sessions',
        {
          headers: {
            host: 'evil.example',
            authorization: `Bearer ${runtime.token}`,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
    }),
    403,
  );
  assert.equal(
    (await api('/api/sessions', 'GET', undefined, { authorization: '' }))
      .status,
    401,
  );
});
test('cannot run two writers against the same state directory', async () => {
  await assert.rejects(
    () => createRuntime({ directory: path.join(dir, 'state') }),
    /Another server/,
  );
});
test('remote, credential-bearing, HTTPS and unsupported file targets are refused', async () => {
  for (const target of [
    'https://localhost:3000',
    'http://example.com',
    'http://user:secret@localhost:3000',
  ])
    assert.equal((await api('/api/open', 'POST', { target })).status, 400);
  await assert.rejects(() => targetOf(path.join(root, 'app.js')), /HTML/);
});
test('file resolution denies hidden files, traversal and escaped symlinks', async () => {
  fs.writeFileSync(path.join(root, '.secret'), 'no');
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'no');
  fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(root, 'escape.txt'));
  await assert.rejects(() => safeFile(root, '/.secret'));
  await assert.rejects(() => safeFile(root, '/%2e%2e/outside.txt'));
  await assert.rejects(() => safeFile(root, '/escape.txt'));
});
test('wait receives an event once, reply acknowledges only that receipt', async () => {
  const s = await opened();
  const before = (await api(`/api/sessions/${s.session}`)).data;
  const wait = api(`/api/sessions/${s.session}/wait`, 'POST', {
    consumer: 'test',
    timeoutMs: 2000,
  });
  await new Promise((r) => setTimeout(r, 30));
  const e = await api(`/api/sessions/${s.session}/events`, 'POST', {
    protocol: 1,
    clientId: crypto.randomUUID(),
    revision: before.revision,
    kind: 'submission',
    payload: { intent: 'new_unregistered_intent', values: { x: 1 } },
  });
  assert.equal(e.status, 200);
  const batch = await wait;
  assert.equal(batch.status, 200);
  assert.equal(batch.data.status, 'feedback');
  assert.equal(batch.data.events[0].payload.values.x, 1);
  assert.equal(
    (
      await api(`/api/sessions/${s.session}/reply`, 'POST', {
        receipt: batch.data.receipt,
        message: 'Updated',
      })
    ).status,
    200,
  );
  const after = (await api(`/api/sessions/${s.session}`)).data;
  assert.equal(after.events[0].status, 'completed');
  assert.equal(after.replies[0].text, 'Updated');
});
test('wait ownership, timeout and end are typed', async () => {
  const s = await opened();
  const first = api(`/api/sessions/${s.session}/wait`, 'POST', {
    consumer: 'a',
    timeoutMs: 2000,
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    (
      await api(`/api/sessions/${s.session}/wait`, 'POST', {
        consumer: 'b',
        timeoutMs: 20,
      })
    ).status,
    409,
  );
  await api(`/api/sessions/${s.session}/end`, 'POST', {});
  assert.equal((await first).data.status, 'ended');
  const fresh = await opened();
  assert.equal(
    (
      await api(`/api/sessions/${fresh.session}/wait`, 'POST', {
        timeoutMs: 10,
      })
    ).data.status,
    'timeout',
  );
});
test('source change rejects stale input without saving the file', async () => {
  const s = await opened();
  const prior = (await api(`/api/sessions/${s.session}`)).data;
  fs.writeFileSync(file, '<!doctype html><h1>New version</h1>');
  const res = await api(`/api/sessions/${s.session}/events`, 'POST', {
    protocol: 1,
    clientId: crypto.randomUUID(),
    revision: prior.revision,
    kind: 'edit',
    payload: { target: { selector: 'h1' }, before: 'Hello', after: 'Replace' },
  });
  assert.equal(res.status, 409);
  assert.match(fs.readFileSync(file, 'utf8'), /New version/);
});
test('proxy preserves paths, JSON API and WebSocket upgrade; rejects external redirect', async () => {
  const app = http.createServer((req, res) => {
    if (req.url === '/api/value') {
      res.setHeader('content-type', 'application/json');
      res.end('{"value":42}');
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: 'https://example.com' });
      res.end();
    } else {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><h1>Existing app</h1>');
    }
  });
  app.on('upgrade', (req, socket) => {
    const accept = createHash('sha1')
      .update(
        req.headers['sec-websocket-key'] +
          '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
      )
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        accept +
        '\r\n\r\n',
    );
    socket.end(Buffer.from([0x88, 0x00]));
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  try {
    const target = `http://127.0.0.1:${app.address().port}/nested`;
    const s = (await api('/api/open', 'POST', { target })).data;
    const view = (await api(`/api/sessions/${s.session}`)).data;
    assert.match(
      await (await fetch(view.surface.frameUrl)).text(),
      /Existing app/,
    );
    assert.deepEqual(
      await (await fetch(view.surface.origin + '/api/value')).json(),
      { value: 42 },
    );
    assert.equal(
      (await fetch(view.surface.origin + '/redirect', { redirect: 'manual' }))
        .status,
      502,
    );
    await new Promise((resolve, reject) => {
      const req = http.request(view.surface.origin + '/hmr', {
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          origin: view.surface.origin,
          'sec-websocket-version': '13',
          'sec-websocket-key': Buffer.alloc(16).toString('base64'),
        },
      });
      req.on('upgrade', (res, socket) => {
        assert.equal(res.statusCode, 101);
        socket.destroy();
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  } finally {
    app.closeAllConnections();
    await new Promise((r) => app.close(r));
  }
});
test('dynamic app snapshots and submissions do not refetch or change revisions', async () => {
  let requests = 0,
    offline = false;
  const app = http.createServer((req, res) => {
    requests++;
    res.writeHead(offline ? 503 : 200, { 'content-type': 'text/html' });
    res.end(`<h1>Dynamic page ${requests}</h1>`);
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  try {
    const result = await api('/api/open', 'POST', {
      target: `http://127.0.0.1:${app.address().port}/dynamic`,
    });
    const id = result.data.session;
    const first = (await api(`/api/sessions/${id}`)).data;
    await fetch(first.surface.frameUrl, {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    const revision = runtime.store.get(id).revision;
    const count = requests;
    const changes = [];
    const changed = (session) => {
      if (session === id) changes.push(session);
    };
    runtime.store.on('change', changed);
    try {
      for (let i = 0; i < 30; i++) {
        const snapshot = await api(`/api/sessions/${id}`);
        assert.equal(snapshot.status, 200);
        assert.equal(snapshot.data.revision, revision);
      }
      assert.equal(requests, count);
      assert.deepEqual(changes, []);
      offline = true;
      const sent = await api(`/api/sessions/${id}/events`, 'POST', {
        protocol: 1,
        clientId: 'dynamic',
        revision,
        kind: 'message',
        payload: { text: 'Review the page I saw.' },
      });
      assert.equal(sent.status, 200);
      assert.equal(requests, count);
    } finally {
      runtime.store.off('change', changed);
    }
  } finally {
    app.closeAllConnections();
    await new Promise((resolve) => app.close(resolve));
  }
});
test('the default workspace keeps its origin across restarts and occupied ports', async () => {
  const directory = fixture('workspace-port');
  let first, second, blocker;
  try {
    first = await createRuntime({ directory });
    const origin = first.origin;
    await first.close();
    first = null;
    blocker = http.createServer();
    await new Promise((resolve) =>
      blocker.listen(Number(new URL(origin).port), '127.0.0.1', resolve),
    );
    await assert.rejects(() => createRuntime({ directory }), {
      code: 'EADDRINUSE',
    });
    await new Promise((resolve) => blocker.close(resolve));
    blocker = null;
    second = await createRuntime({ directory });
    assert.equal(second.origin, origin);
  } finally {
    if (first) await first.close();
    if (second) await second.close();
    if (blocker) await new Promise((resolve) => blocker.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function until(condition, label) {
  const deadline = Date.now() + 3000;
  while (!(await condition())) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function nodeRuntime(directory) {
  const script = `
    import { createRuntime } from ${JSON.stringify(new URL('../dist/server.js', import.meta.url).href)};
    const runtime = await createRuntime({ directory: process.argv[1] });
    process.send({ type: 'ready', origin: runtime.origin, token: runtime.token, version: process.versions.node });
    process.on('message', async ({ id, action }) => {
      if (action === 'listeners') {
        process.send({ id, value: runtime.store.listenerCount('change') });
      } else if (action === 'close') {
        await runtime.close();
        process.send({ id, value: true }, () => process.disconnect());
      }
    });
  `;
  const child = spawn(
    'node',
    ['--input-type=module', '--eval', script, directory],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => (stderr += chunk));
  let resolveReady, rejectReady, resolveExit;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const exited = new Promise((resolve) => (resolveExit = resolve));
  const pending = new Map();
  let nextId = 0;
  child.on('message', (message) => {
    if (message.type === 'ready') resolveReady(message);
    else {
      const reply = pending.get(message.id);
      if (reply) {
        pending.delete(message.id);
        reply.resolve(message.value);
      }
    }
  });
  child.on('error', rejectReady);
  child.on('close', (code, signal) => {
    const error = new Error(`Node child exited (${code ?? signal}): ${stderr}`);
    rejectReady(error);
    for (const reply of pending.values()) reply.reject(error);
    pending.clear();
    resolveExit({ code, signal });
  });
  ready.catch(() => {});
  function call(action) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.send({ id, action }, (error) => {
        if (error && pending.delete(id)) reject(error);
      });
    });
  }
  return { child, ready, exited, call };
}

async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}`)),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function pendingWait(server, id) {
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(
      `${server.origin}/api/sessions/${id}/wait`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${server.token}`,
          'content-type': 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('Wait response aborted')));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.end(
      JSON.stringify({ consumer: 'disconnect-test', timeoutMs: 10000 }),
    );
  });
  response.catch(() => {});
  return { request, response };
}

function pendingStream(server, id, headers = {}) {
  let request;
  const ready = new Promise((resolve, reject) => {
    request = http.get(
      `${server.origin}/api/sessions/${id}/stream`,
      { headers: { authorization: `Bearer ${server.token}`, ...headers } },
      (response) => {
        let contents = '';
        let finish;
        const ended = new Promise((done) => (finish = done));
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          contents += chunk;
          if (contents.includes('event: ready\n'))
            resolve({ response, ended, contents: () => contents });
        });
        response.on('end', () => finish('end'));
        response.on('close', () => finish('close'));
        response.on('error', reject);
      },
    );
    request.on('error', reject);
  });
  ready.catch(() => {});
  return { request, ready };
}

async function openDistinct(server, name) {
  const target = path.join(root, `${name}.html`);
  fs.writeFileSync(target, '<!doctype html><h1>Disconnect test</h1>');
  const response = await fetch(`${server.origin}/api/open`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${server.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ target }),
  });
  assert.equal(response.status, 200);
  return { ...(await response.json()), targetPath: target };
}

async function checkHostResponses(server) {
  const address = new URL(server.origin);
  const missing = await within(
    new Promise((resolve, reject) => {
      let data = '';
      const socket = net.createConnection(
        { host: address.hostname, port: Number(address.port) },
        () => socket.write('GET /health HTTP/1.0\r\nConnection: close\r\n\r\n'),
      );
      socket.setEncoding('utf8');
      socket.setTimeout(3000, () =>
        socket.destroy(new Error('Host request timed out')),
      );
      socket.on('data', (chunk) => (data += chunk));
      socket.on('error', reject);
      socket.on('end', () => resolve(data));
    }),
    'missing Host response',
  );
  const separator = missing.indexOf('\r\n\r\n');
  assert.notEqual(separator, -1);
  const head = missing.slice(0, separator);
  assert.match(head, /^HTTP\/1\.[01] 403\b/);
  assert.match(head, /\r\ncontent-type: application\/json\b/i);
  assert.equal(JSON.parse(missing.slice(separator + 4)).error, 'FORBIDDEN');

  for (const host of ['', '[::1', 'bad host', 'evil.example']) {
    const result = await within(
      new Promise((resolve, reject) => {
        const request = http.request(
          `${server.origin}/health`,
          {
            setHost: false,
            headers: { host },
          },
          (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => (body += chunk));
            response.on('error', reject);
            response.on('end', () => {
              resolve({
                status: response.statusCode,
                type: response.headers['content-type'],
                body,
              });
            });
          },
        );
        request.on('error', reject);
        request.end();
      }),
      `host response for ${JSON.stringify(host)}`,
    );
    assert.equal(result.status, 403, `host ${JSON.stringify(host)}`);
    assert.match(result.type, /^application\/json\b/);
    assert.equal(JSON.parse(result.body).error, 'FORBIDDEN');
  }
}

test('real server rejects missing, malformed, and foreign Host headers with JSON', async () => {
  await checkHostResponses(runtime);
});

test('disconnecting a pending wait releases its listener and preserves the next event', async () => {
  const session = await openDistinct(runtime, 'wait-disconnect');
  const id = session.session;
  const baseline = runtime.store.listenerCount('change');
  const first = pendingWait(runtime, id);
  let next;
  try {
    await until(
      () => runtime.store.listenerCount('change') === baseline + 1,
      'first waiter',
    );
    first.request.destroy();
    await until(
      () => runtime.store.listenerCount('change') === baseline,
      'disconnected waiter cleanup',
    );
    next = pendingWait(runtime, id);
    await until(
      () => runtime.store.listenerCount('change') === baseline + 1,
      'replacement waiter',
    );
    const revision = runtime.store.get(id).revision;
    const sent = await api(`/api/sessions/${id}/events`, 'POST', {
      protocol: 1,
      clientId: 'after-disconnect',
      revision,
      kind: 'message',
      payload: { text: 'Keep this event' },
    });
    assert.equal(sent.status, 200);
    const received = await within(next.response, 'replacement wait response');
    assert.equal(received.status, 200);
    assert.equal(received.data.status, 'feedback');
    assert.equal(received.data.target.value, session.targetPath);
    assert.equal(received.data.events[0].id, sent.data.id);
    assert.equal(received.data.events[0].revision, revision);
    assert.equal(
      (
        await api(`/api/sessions/${id}/ack`, 'POST', {
          receipt: received.data.receipt,
        })
      ).status,
      200,
    );
    await until(
      () => runtime.store.listenerCount('change') === baseline,
      'completed waiter cleanup',
    );
  } finally {
    first.request.destroy();
    next?.request.destroy();
  }
});

test('disconnecting an SSE client removes its listener and a replacement receives changes', async () => {
  const session = await openDistinct(runtime, 'stream-disconnect');
  const id = session.session;
  const baseline = runtime.store.listenerCount('change');
  const first = pendingStream(runtime, id, {
    authorization: '',
    'x-humagent-session': new URL(session.url).hash.slice(1),
  });
  let next;
  try {
    const stream = await within(first.ready, 'first SSE connection');
    assert.equal(stream.response.statusCode, 200);
    assert.match(
      stream.response.headers['content-type'],
      /^text\/event-stream/,
    );
    await until(
      () => runtime.store.listenerCount('change') === baseline + 1,
      'first SSE listener',
    );
    stream.response.destroy();
    first.request.destroy();
    await until(
      () => runtime.store.listenerCount('change') === baseline,
      'disconnected SSE cleanup',
    );
    next = pendingStream(runtime, id);
    const replacement = await within(next.ready, 'replacement SSE connection');
    await until(
      () => runtime.store.listenerCount('change') === baseline + 1,
      'replacement SSE listener',
    );
    const revision = runtime.store.get(id).revision;
    const sent = await api(`/api/sessions/${id}/events`, 'POST', {
      protocol: 1,
      clientId: 'stream-change',
      revision,
      kind: 'message',
      payload: { text: 'Notify the new stream' },
    });
    assert.equal(sent.status, 200);
    await until(
      () => replacement.contents().includes('event: change\n'),
      'SSE change event',
    );
    const batch = await api(`/api/sessions/${id}/wait`, 'POST', {
      consumer: 'stream-test',
      timeoutMs: 100,
    });
    assert.equal(batch.data.events[0].id, sent.data.id);
    replacement.response.destroy();
    next.request.destroy();
    await until(
      () => runtime.store.listenerCount('change') === baseline,
      'replacement SSE cleanup',
    );
  } finally {
    first.request.destroy();
    next?.request.destroy();
  }
});

test('shutdown completes pending waits and SSE clients and releases the state directory', async () => {
  const directory = fixture('shutdown');
  let server, waiter, stream;
  try {
    server = await createRuntime({ directory });
    const session = await openDistinct(server, 'shutdown-clients');
    const baseline = server.store.listenerCount('change');
    waiter = pendingWait(server, session.session);
    await until(
      () => server.store.listenerCount('change') === baseline + 1,
      'shutdown waiter',
    );
    stream = pendingStream(server, session.session);
    const connected = await within(stream.ready, 'shutdown SSE connection');
    await until(
      () => server.store.listenerCount('change') === baseline + 2,
      'shutdown clients',
    );
    await within(server.close(), 'server shutdown');
    const result = await within(waiter.response, 'interrupted waiter');
    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'interrupted');
    assert.equal(await within(connected.ended, 'SSE completion'), 'end');
    await until(
      () => server.store.listenerCount('change') === baseline,
      'shutdown listener cleanup',
    );
    const restarted = await createRuntime({ directory });
    await restarted.close();
  } finally {
    waiter?.request.destroy();
    stream?.request.destroy();
    if (server) await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Node transport cleans up disconnected waits and streams and shuts down pending clients', async () => {
  const directory = fixture('node-disconnect');
  const node = nodeRuntime(directory);
  let firstWait, firstStream, nextWait, nextStream, shutdownWait;
  try {
    const server = await within(node.ready, 'Node server startup');
    assert.ok(Number(server.version.split('.')[0]) >= 24);
    await checkHostResponses(server);
    const session = await openDistinct(server, 'node-disconnect');
    const id = session.session;
    const baseline = await within(
      node.call('listeners'),
      'Node listener count',
    );
    const countIs = (count) => async () =>
      (await within(node.call('listeners'), 'Node listener count')) === count;

    firstWait = pendingWait(server, id);
    await until(countIs(baseline + 1), 'Node pending waiter');
    firstWait.request.destroy();
    await until(countIs(baseline), 'Node disconnected waiter cleanup');

    firstStream = pendingStream(server, id, {
      authorization: '',
      'x-humagent-session': new URL(session.url).hash.slice(1),
    });
    const initialStream = await within(
      firstStream.ready,
      'Node SSE connection',
    );
    await until(countIs(baseline + 1), 'Node SSE listener');
    initialStream.response.destroy();
    firstStream.request.destroy();
    await until(countIs(baseline), 'Node disconnected SSE cleanup');

    nextWait = pendingWait(server, id);
    nextStream = pendingStream(server, id);
    const replacement = await within(nextStream.ready, 'Node replacement SSE');
    await until(countIs(baseline + 2), 'Node replacement clients');
    const snapshot = await fetch(`${server.origin}/api/sessions/${id}`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    assert.equal(snapshot.status, 200);
    const revision = (await snapshot.json()).revision;
    const response = await fetch(`${server.origin}/api/sessions/${id}/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${server.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        protocol: 1,
        clientId: 'node-after-disconnect',
        revision,
        kind: 'message',
        payload: { text: 'Keep the Node event' },
      }),
    });
    assert.equal(response.status, 200);
    const event = await response.json();
    const delivered = await within(nextWait.response, 'Node replacement wait');
    assert.equal(delivered.status, 200);
    assert.equal(delivered.data.status, 'feedback');
    assert.equal(delivered.data.target.value, session.targetPath);
    assert.equal(delivered.data.events[0].id, event.id);
    assert.equal(delivered.data.events[0].revision, revision);
    await until(
      () => replacement.contents().includes('event: change\n'),
      'Node SSE change event',
    );
    const ack = await fetch(`${server.origin}/api/sessions/${id}/ack`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${server.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ receipt: delivered.data.receipt }),
    });
    assert.equal(ack.status, 200);
    shutdownWait = pendingWait(server, id);
    await until(countIs(baseline + 2), 'Node shutdown clients');
    await within(node.call('close'), 'Node server shutdown');
    const interrupted = await within(
      shutdownWait.response,
      'Node interrupted wait',
    );
    assert.equal(interrupted.status, 200);
    assert.equal(interrupted.data.status, 'interrupted');
    assert.equal(await within(replacement.ended, 'Node SSE completion'), 'end');
    const exit = await within(node.exited, 'Node child exit');
    assert.equal(exit.code, 0);
  } finally {
    firstWait?.request.destroy();
    firstStream?.request.destroy();
    nextWait?.request.destroy();
    nextStream?.request.destroy();
    shutdownWait?.request.destroy();
    if (node.child.exitCode === null && node.child.signalCode === null) {
      if (node.child.connected) {
        try {
          await within(node.call('close'), 'Node cleanup');
        } catch {
          node.child.kill('SIGKILL');
        }
      } else node.child.kill('SIGKILL');
    }
    await within(node.exited, 'Node cleanup exit');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
