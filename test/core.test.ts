import { test, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixtures.ts';
import path from 'node:path';
import { Store } from '../dist/runtime/store.js';
import { input, jsonValue } from '../dist/runtime/protocol.js';
import { buildContext } from '../dist/sdk/targets.js';
import { cloneJson } from '../dist/shared/json.js';
const directories: string[] = [];
afterAll(() =>
  directories.forEach((dir) =>
    fs.rmSync(dir, { recursive: true, force: true }),
  ),
);
function setup() {
  const dir = fixture('core');
  directories.push(dir);
  const store = new Store(dir);
  const session = store.open(
    { kind: 'file', value: '/tmp/a.html', root: '/tmp', network: false },
    'v1',
  );
  return { dir, store, id: session.id };
}
const message = (clientId = 'one', revision = 'v1') => ({
  protocol: 2,
  clientId,
  revision,
  payload: { message: 'Review this', items: [] },
});
test('validates structured submissions without turning intent into code', () => {
  const e = input({
    protocol: 2,
    clientId: 'x',
    revision: 'v',
    payload: {
      items: [
        {
          id: 'decision',
          intent: 'entirely_new_workflow',
          values: { priority: 2, choices: ['a'] },
        },
      ],
    },
  });
  assert.deepEqual(e.payload.items[0].values, { priority: 2, choices: ['a'] });
});
test('rejects malformed payloads and reserved keys', () => {
  assert.throws(() => input({ ...message(), protocol: 1 }));
  assert.throws(() => input({ ...message(), kind: 'execute' }));
  assert.throws(() =>
    input({ ...message(), payload: { message: '', items: [] } }),
  );
  assert.throws(() => jsonValue(JSON.parse('{"__proto__":{"x":1}}')));
  assert.throws(() => jsonValue({ x: Infinity }));
  assert.throws(() =>
    input({
      ...message(),
      payload: { message: 'a'.repeat(300000), items: [] },
    }),
  );
});
test('review targets preserve arbitrary JSON metadata', () => {
  const target = {
    id: 7,
    tag: ['section'],
    anchor: { quote: 3 },
    revision: 'v1',
  };
  const event = input({
    ...message(),
    payload: { items: [{ id: 'note', target, comment: 'Review this target' }] },
  });
  assert.deepEqual(event.payload.items[0].target, target);
});
test('persists before receipt; same client ID is idempotent', () => {
  const { store, id, dir } = setup();
  const one = store.send(id, message());
  assert.equal(store.send(id, message()).id, one.id);
  assert.equal(new Store(dir).get(id).events.length, 1);
  assert.throws(
    () =>
      store.send(id, {
        ...message(),
        payload: { message: 'different', items: [] },
      }),
    /reused/,
  );
});
test('stale revision refuses new input but an accepted retry still succeeds', () => {
  const { store, id } = setup();
  const old = store.send(id, message());
  store.setRevision(id, 'v2');
  assert.equal(store.send(id, message()).id, old.id);
  assert.throws(() => store.send(id, message('two')), /interface changed/);
});
test('working state uses separate optimistic version', () => {
  const { store, id } = setup();
  store.saveState(id, 0, { selection: 'a' });
  assert.equal(store.saveState(id, 0, { selection: 'a' }).stateVersion, 1);
  assert.equal(store.get(id).revision, 'v1');
  assert.throws(
    () => store.saveState(id, 0, { selection: 'b' }),
    /another view/,
  );
  assert.equal(store.get(id).state.selection, 'a');
});
test('receipt completes only leased events, not newer input', () => {
  const { store, id } = setup();
  store.send(id, message());
  const batch = store.take(id, 'agent');
  assert.ok(batch?.status === 'feedback');
  store.send(id, message('two'));
  store.acknowledge(id, batch.receipt);
  assert.deepEqual(
    store.get(id).events.map((e) => e.status),
    ['completed', 'queued'],
  );
  store.acknowledge(id, batch.receipt);
  assert.deepEqual(store.get(id).acknowledged, [batch.receipt]);
});
test('lease excludes competing consumers and expires into redelivery', () => {
  const { store, id } = setup();
  store.send(id, message());
  const first = store.take(id, 'a', 1000, Date.now() - 2000);
  assert.ok(first?.status === 'feedback');
  const second = store.take(id, 'b');
  assert.ok(second?.status === 'feedback');
  assert.equal(first.events[0].id, second.events[0].id);
  assert.equal(second.events[0].deliveries, 2);
  assert.throws(() => store.take(id, 'c'), /leased/);
  assert.throws(
    () => store.acknowledge(id, first.receipt),
    /unknown or expired/,
  );
});
test('restart retains an outstanding lease and pending event', () => {
  const { store, id, dir } = setup();
  store.send(id, message());
  const batch = store.take(id, 'agent');
  assert.ok(batch?.status === 'feedback');
  const resumed = new Store(dir);
  assert.throws(() => resumed.take(id, 'other'), /leased/);
  resumed.acknowledge(id, batch.receipt);
  assert.equal(resumed.get(id).events[0].status, 'completed');
});
test('renewal validates receipt and extends its lease', () => {
  const { store, id } = setup();
  store.send(id, message());
  const batch = store.take(id, 'agent', 1000);
  assert.ok(batch?.status === 'feedback');
  assert.throws(() => store.renew(id, undefined));
  store.renew(id, batch.receipt, 10000);
  assert.ok(store.get(id).lease!.expiresAt > batch.leaseExpiresAt);
});
test('ending a session rejects writes but delivers previously queued work', () => {
  const { store, id } = setup();
  store.send(id, message());
  store.end(id);
  assert.throws(() => store.send(id, message('new')), /ended/);
  assert.throws(() => store.saveState(id, 0, {}), /ended/);
  const batch = store.take(id, 'agent');
  assert.ok(batch?.status === 'feedback');
  store.acknowledge(id, batch.receipt);
  assert.equal(store.take(id, 'agent')?.status, 'ended');
});
test('quote context preserves exact text at document boundaries', () => {
  assert.deepEqual(buildContext('one\n two', 0, 8), {
    prefix: '',
    quote: 'one\n two',
    suffix: '',
  });
  const text = 'left: hello. right: hello.';
  const start = text.lastIndexOf('hello');
  assert.deepEqual(buildContext(text, start, start + 5, 7), {
    prefix: 'right: ',
    quote: 'hello',
    suffix: '.',
  });
});
test('session writes leave other session files untouched', () => {
  const { dir, store, id } = setup();
  const other = store.open(
    { kind: 'file', value: '/tmp/b.html', root: '/tmp', network: false },
    'v2',
  );
  const file = path.join(dir, 'sessions', `${other.id}.json`);
  const before = fs.statSync(file, { bigint: true });
  store.send(id, message());
  assert.equal(fs.statSync(file, { bigint: true }).mtimeNs, before.mtimeNs);
  const restarted = new Store(dir);
  assert.equal(restarted.get(id).events.length, 1);
  assert.equal(restarted.get(other.id).events.length, 0);
});
test('corruption in one session does not hide other sessions', () => {
  const { dir, store, id } = setup();
  const other = store.open(
    { kind: 'file', value: '/tmp/b.html', root: '/tmp', network: false },
    'v2',
  );
  const corrupt = path.join(dir, 'sessions', `${id}.json`);
  for (const content of [
    'invalid',
    JSON.stringify({
      protocol: 1,
      session: {
        ...store.get(id),
        target: { kind: 'url', value: 'invalid', network: true },
      },
    }),
    JSON.stringify({ protocol: 1, session: { ...store.get(id), state: [] } }),
  ]) {
    fs.writeFileSync(corrupt, content);
    const recovered = new Store(dir);
    assert.equal(recovered.get(other.id).revision, 'v2');
    assert.throws(() => recovered.get(id), /unreadable/);
    assert.equal(recovered.errors()[0].id, id);
    assert.equal(fs.readFileSync(corrupt, 'utf8'), content);
  }
});
test('SDK JSON validation rejects lossy values before copying', () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const hidden = {};
  Object.defineProperty(hidden, 'secret', { value: 1 });
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    undefined,
    () => {},
    Symbol('x'),
    1n,
    new Date(),
    new Map(),
    cyclic,
    Array(1),
    hidden,
    { [Symbol('x')]: 1 },
  ]) {
    assert.throws(() => cloneJson({ values: { value } }));
  }
  const value = {
    values: { finite: 1, array: [null, true, 'exact'], shared: { x: 1 } },
  };
  const copied = cloneJson(value);
  assert.deepEqual(copied, value);
  assert.notEqual(copied.values, value.values);
});
