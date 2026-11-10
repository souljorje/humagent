import { test, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixtures.ts';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../dist/runtime/server.js';
import { targetOf, safeFile } from '../dist/runtime/surfaces.js';

type Runtime = Awaited<ReturnType<typeof createRuntime>>;
type ServerAddress = Pick<Runtime, 'origin' | 'token'>;
type Feedback = Extract<
  NonNullable<ReturnType<Runtime['store']['take']>>,
  { status: 'feedback' }
>;
type WaitResult = Feedback | { status: 'ended' | 'interrupted' };
interface NodeReady extends ServerAddress {
  type: 'ready';
  version: string;
}
type ChildMessage = NodeReady | { id: number; value: number | boolean };

const dir = fixture('http');
const root = path.join(dir, 'artifacts');
fs.mkdirSync(root);
const file = path.join(root, 'index.html');
fs.writeFileSync(
  file,
  '<!doctype html><html><body><h1>Hello</h1><script>const literal="</body>";</script></body></html>',
);
fs.writeFileSync(path.join(root, 'app.js'), 'window.works=true;');
let runtime: Awaited<ReturnType<typeof createRuntime>>;
beforeAll(async () => {
  runtime = await createRuntime({ directory: path.join(dir, 'state') });
});
afterAll(async () => {
  await runtime.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
async function api(
  route: string,
  method = 'GET',
  data?: unknown,
  headers: Record<string, string> = {},
) {
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
    page.headers.get('content-security-policy')!,
    /connect-src 'none'/,
  );
  assert.match(
    await (await fetch(snapshot.surface.origin + '/app.js')).text(),
    /works=true/,
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
/** Stage an overall instruction and send it as one event. */
async function queue(id: string, message = 'Review this', revision?: string) {
  await api(`/api/sessions/${id}/message`, 'PUT', { text: message });
  return api(`/api/sessions/${id}/send`, 'POST', {
    revision: revision ?? runtime.store.get(id).revision,
  });
}
test('wait ownership and end are typed', async () => {
  const s = await opened();
  const first = api(`/api/sessions/${s.session}/wait`, 'POST', {});
  await until(
    async () =>
      (await api(`/api/sessions/${s.session}`)).data.agent === 'waiting',
    'agent listening',
  );
  assert.equal(
    (await api(`/api/sessions/${s.session}/wait`, 'POST', {})).status,
    409,
  );
  await api(`/api/sessions/${s.session}/end`, 'POST', {});
  assert.equal((await first).data.status, 'ended');
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
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  try {
    const target = `http://127.0.0.1:${(app.address() as AddressInfo).port}/nested`;
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
    await new Promise<void>((resolve, reject) => {
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
async function until(
  condition: () => boolean | Promise<boolean>,
  label: string,
) {
  const deadline = Date.now() + 3000;
  while (!(await condition())) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function nodeRuntime(directory: string) {
  const script = fileURLToPath(
    new URL('./helpers/node-runtime.ts', import.meta.url),
  );
  const child = spawn('node', [script, directory], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk) => (stderr += chunk));
  type Exit = { code: number | null; signal: NodeJS.Signals | null };
  let resolveReady!: (ready: NodeReady) => void,
    rejectReady!: (error: Error) => void,
    resolveExit!: (exit: Exit) => void;
  const ready = new Promise<NodeReady>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const exited = new Promise<Exit>((resolve) => (resolveExit = resolve));
  const pending = new Map<
    number,
    { resolve(value: number | boolean): void; reject(error: Error): void }
  >();
  let nextId = 0;
  child.on('message', (raw) => {
    const message = raw as ChildMessage;
    if ('type' in message) resolveReady(message);
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
  function call<M extends 'listeners' | 'close'>(
    action: M,
  ): Promise<M extends 'listeners' ? number : boolean> {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, {
        resolve: (value) =>
          resolve(value as M extends 'listeners' ? number : boolean),
        reject,
      });
      child.send({ id, action }, (error) => {
        if (error && pending.delete(id)) reject(error);
      });
    });
  }
  return { child, ready, exited, call };
}

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
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

function pendingWait(server: ServerAddress, id: string) {
  let request!: http.ClientRequest;
  const response = new Promise<{
    status: number | undefined;
    data: WaitResult;
  }>((resolve, reject) => {
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
    request.end('{}');
  });
  response.catch(() => {});
  return { request, response };
}

async function openDistinct(server: ServerAddress, name: string) {
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

async function checkHostResponses(server: ServerAddress) {
  const address = new URL(server.origin);
  const missing = await within(
    new Promise<string>((resolve, reject) => {
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
      new Promise<{
        status: number | undefined;
        type: string | undefined;
        body: string;
      }>((resolve, reject) => {
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
    assert.match(result.type!, /^application\/json\b/);
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
    const sent = await queue(id, 'Keep this event');
    assert.equal(sent.status, 200);
    const received = await within(next.response, 'replacement wait response');
    assert.equal(received.status, 200);
    assert.equal(received.data.status, 'feedback');
    assert.equal(received.data.target.value, session.targetPath);
    assert.equal(received.data.events[0].id, sent.data.event.id);
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

test('shutdown completes pending waits and releases the state directory', async () => {
  const directory = fixture('shutdown');
  let server!: Runtime, waiter: ReturnType<typeof pendingWait> | undefined;
  try {
    server = await createRuntime({ directory });
    const session = await openDistinct(server, 'shutdown-clients');
    const baseline = server.store.listenerCount('change');
    waiter = pendingWait(server, session.session);
    await until(
      () => server.store.listenerCount('change') === baseline + 1,
      'shutdown waiter',
    );
    await within(server.close(), 'server shutdown');
    const result = await within(waiter.response, 'interrupted waiter');
    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'interrupted');
    await until(
      () => server.store.listenerCount('change') === baseline,
      'shutdown listener cleanup',
    );
    const restarted = await createRuntime({ directory });
    await restarted.close();
  } finally {
    waiter?.request.destroy();
    if (server) await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Node transport cleans up disconnected waits and shuts down pending clients', async () => {
  const directory = fixture('node-disconnect');
  const node = nodeRuntime(directory);
  let firstWait, nextWait, shutdownWait;
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
    const countIs = (count: number) => async () =>
      (await within(node.call('listeners'), 'Node listener count')) === count;

    firstWait = pendingWait(server, id);
    await until(countIs(baseline + 1), 'Node pending waiter');
    firstWait.request.destroy();
    await until(countIs(baseline), 'Node disconnected waiter cleanup');

    nextWait = pendingWait(server, id);
    await until(countIs(baseline + 1), 'Node replacement waiter');
    const snapshot = await fetch(`${server.origin}/api/sessions/${id}`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    assert.equal(snapshot.status, 200);
    const revision = (await snapshot.json()).revision;
    const write = (action: string, method: string, data: unknown) =>
      fetch(`${server.origin}/api/sessions/${id}/${action}`, {
        method,
        headers: {
          authorization: `Bearer ${server.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(data),
      });
    await write('message', 'PUT', { text: 'Keep the Node event' });
    const response = await write('send', 'POST', { revision });
    assert.equal(response.status, 200);
    const { event } = await response.json();
    const delivered = await within(nextWait.response, 'Node replacement wait');
    assert.equal(delivered.status, 200);
    assert.equal(delivered.data.status, 'feedback');
    assert.equal(delivered.data.target.value, session.targetPath);
    assert.equal(delivered.data.events[0].id, event.id);
    assert.equal(delivered.data.events[0].revision, revision);
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
    await until(countIs(baseline + 1), 'Node shutdown waiter');
    await within(node.call('close'), 'Node server shutdown');
    const interrupted = await within(
      shutdownWait.response,
      'Node interrupted wait',
    );
    assert.equal(interrupted.status, 200);
    assert.equal(interrupted.data.status, 'interrupted');
    const exit = await within(node.exited, 'Node child exit');
    assert.equal(exit.code, 0);
  } finally {
    firstWait?.request.destroy();
    nextWait?.request.destroy();
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
