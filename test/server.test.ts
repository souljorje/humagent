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
let runtime: Runtime;
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
  server: ServerAddress = runtime,
) {
  const res = await fetch(server.origin + route, {
    method,
    headers: {
      authorization: `Bearer ${server.token}`,
      'content-type': 'application/json',
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: res.status, data: await res.json() };
}
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

test('opening targets isolates surfaces and refuses unsafe targets and paths', async () => {
  const s = (await api('/api/open', 'POST', { target: file })).data;
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
  for (const target of [
    'https://localhost:3000',
    'http://example.com',
    'http://user:secret@localhost:3000',
  ])
    assert.equal((await api('/api/open', 'POST', { target })).status, 400);
  await assert.rejects(() => targetOf(path.join(root, 'app.js')), /HTML/);
  fs.writeFileSync(path.join(root, '.secret'), 'no');
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'no');
  fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(root, 'escape.txt'));
  await assert.rejects(() => safeFile(root, '/.secret'));
  await assert.rejects(() => safeFile(root, '/%2e%2e/outside.txt'));
  await assert.rejects(() => safeFile(root, '/escape.txt'));
});
test('cannot run two writers against the same state directory', async () => {
  await assert.rejects(
    () => createRuntime({ directory: path.join(dir, 'state') }),
    /Another server/,
  );
});

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
  const response = await api('/api/open', 'POST', { target }, server);
  assert.equal(response.status, 200);
  return { ...response.data, targetPath: target };
}

/** Drop one wait, deliver the next event, then interrupt a wait on close. */
async function checkWaits(
  server: ServerAddress,
  listeners: () => Promise<number>,
  close: () => Promise<unknown>,
) {
  const session = await openDistinct(
    server,
    `waits-${new URL(server.origin).port}`,
  );
  const id = session.session;
  const baseline = await listeners();
  const countIs = (count: number) => async () => (await listeners()) === count;
  const waits: ReturnType<typeof pendingWait>[] = [];
  async function wait(label: string) {
    const waiter = pendingWait(server, id);
    waits.push(waiter);
    await until(countIs(baseline + 1), label);
    return waiter;
  }
  try {
    (await wait('first waiter')).request.destroy();
    await until(countIs(baseline), 'disconnected waiter cleanup');
    const next = await wait('replacement waiter');
    const snapshot = await api(`/api/sessions/${id}`, 'GET', undefined, server);
    assert.equal(snapshot.status, 200);
    const { revision } = snapshot.data;
    await api(
      `/api/sessions/${id}/message`,
      'PUT',
      { text: 'Keep this event' },
      server,
    );
    const sent = await api(
      `/api/sessions/${id}/send`,
      'POST',
      { revision },
      server,
    );
    assert.equal(sent.status, 200);
    const received = await within(next.response, 'replacement wait response');
    assert.equal(received.status, 200);
    assert.equal(received.data.status, 'feedback');
    assert.equal(received.data.target.value, session.targetPath);
    assert.equal(received.data.events[0].id, sent.data.event.id);
    assert.equal(received.data.events[0].revision, revision);
    const ack = await api(
      `/api/sessions/${id}/ack`,
      'POST',
      { receipt: received.data.receipt },
      server,
    );
    assert.equal(ack.status, 200);
    await until(countIs(baseline), 'completed waiter cleanup');
    const last = await wait('shutdown waiter');
    await within(close(), 'server shutdown');
    const interrupted = await within(last.response, 'interrupted waiter');
    assert.equal(interrupted.status, 200);
    assert.equal(interrupted.data.status, 'interrupted');
  } finally {
    for (const waiter of waits) waiter.request.destroy();
  }
}

test('waits are typed, disconnect-safe, and interrupted on shutdown', async () => {
  const directory = fixture('shutdown');
  let server: Runtime | undefined;
  try {
    server = await createRuntime({ directory });
    const owned = server;
    const s = await openDistinct(owned, 'typed-wait');
    const first = api(`/api/sessions/${s.session}/wait`, 'POST', {}, owned);
    await until(
      async () =>
        (await api(`/api/sessions/${s.session}`, 'GET', undefined, owned)).data
          .agent === 'waiting',
      'agent listening',
    );
    const second = await api(
      `/api/sessions/${s.session}/wait`,
      'POST',
      {},
      owned,
    );
    assert.equal(second.status, 409);
    assert.equal(second.data.error, 'LISTENER_ACTIVE');
    await api(`/api/sessions/${s.session}/end`, 'POST', {}, owned);
    assert.equal((await first).data.status, 'ended');
    const listeners = async () => owned.store.listenerCount('change');
    const baseline = await listeners();
    await checkWaits(owned, listeners, () => owned.close());
    await until(
      async () => (await listeners()) === baseline,
      'shutdown listener cleanup',
    );
    await (await createRuntime({ directory })).close();
  } finally {
    await server?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
  let resolveReady!: (ready: NodeReady) => void,
    rejectReady!: (error: Error) => void,
    resolveExit!: (code: number | null) => void;
  const ready = new Promise<NodeReady>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});
  const exited = new Promise<number | null>((r) => (resolveExit = r));
  type Reply = {
    resolve(value: number | boolean): void;
    reject(e: Error): void;
  };
  const pending = new Map<number, Reply>();
  let nextId = 0;
  child.on('message', (raw) => {
    const message = raw as ChildMessage;
    if ('type' in message) resolveReady(message);
    else pending.get(message.id)?.resolve(message.value);
  });
  child.on('error', rejectReady);
  child.on('close', (code, signal) => {
    const error = new Error(`Node child exited (${code ?? signal}): ${stderr}`);
    rejectReady(error);
    for (const reply of pending.values()) reply.reject(error);
    resolveExit(code);
  });
  const call = (action: 'listeners' | 'close') =>
    new Promise<number | boolean>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.send({ id, action }, (error) => error && reject(error));
    });
  return { child, ready, exited, call };
}

/** Send /health over a raw socket so the Host header can be absent or malformed. */
function rawHealth(server: ServerAddress, host?: string) {
  const address = new URL(server.origin);
  const header = host === undefined ? '' : `Host: ${host}\r\n`;
  return within(
    new Promise<string>((resolve, reject) => {
      let data = '';
      const socket = net.createConnection(
        { host: address.hostname, port: Number(address.port) },
        () =>
          socket.write(
            `GET /health HTTP/1.0\r\n${header}Connection: close\r\n\r\n`,
          ),
      );
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => (data += chunk));
      socket.on('error', reject);
      socket.on('end', () => resolve(data));
    }),
    `host response for ${JSON.stringify(host)}`,
  );
}

async function checkHostResponses(server: ServerAddress) {
  for (const host of [
    undefined,
    '',
    '[::1',
    'bad host',
    'evil.example',
    'localhost:1234',
  ]) {
    const response = await rawHealth(server, host);
    const separator = response.indexOf('\r\n\r\n');
    assert.notEqual(separator, -1);
    const head = response.slice(0, separator);
    assert.match(head, /^HTTP\/1\.[01] 403\b/, `host ${JSON.stringify(host)}`);
    assert.match(head, /\r\ncontent-type: application\/json\b/i);
    assert.equal(JSON.parse(response.slice(separator + 4)).error, 'FORBIDDEN');
  }
}

test('real server and Node transport enforce Host and lifecycle', async () => {
  await checkHostResponses(runtime);
  const directory = fixture('node-disconnect');
  const node = nodeRuntime(directory);
  try {
    const server = await within(node.ready, 'Node server startup');
    assert.ok(Number(server.version.split('.')[0]) >= 24);
    await checkHostResponses(server);
    await checkWaits(
      server,
      async () =>
        (await within(node.call('listeners'), 'Node listener count')) as number,
      () => node.call('close'),
    );
    assert.equal(await within(node.exited, 'Node child exit'), 0);
  } finally {
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
