import { test, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixtures.ts';
import path from 'node:path';
import { Store } from '../dist/runtime/store.js';
import { parseJson } from '../dist/runtime/validate.js';
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
const comment = (text = 'Review this') => ({
  revision: 'v1',
  item: { target: { selector: 'h1' }, comment: text },
});
function queue(store: Store, id: string, message = 'Review this') {
  store.setMessage(id, message);
  return store.send(id, store.get(id).revision);
}

test('decisions stay data and targets keep arbitrary JSON metadata', () => {
  const { store, id } = setup();
  const target = {
    id: 7,
    tag: ['section'],
    anchor: { quote: 3 },
    revision: 'v1',
  };
  store.addDraft(id, {
    revision: 'v1',
    item: { intent: 'entirely_new_workflow', values: { priority: 2 } },
  });
  store.addDraft(id, { revision: 'v1', item: { target, comment: 'Here' } });
  const [decision, note] = store.get(id).drafts;
  assert.deepEqual(decision.item.values, { priority: 2 });
  assert.deepEqual(note.item.target, target);
});
test('rejects malformed items, unknown fields, and unsafe JSON', () => {
  const { store, id } = setup();
  for (const item of [
    { target: { selector: 'h1' }, comment: 'x', kind: 'execute' },
    { target: { selector: 'h1' }, comment: ' ' },
    { replacement: { before: 'a', after: 'b' } },
    { target: { selector: 'h1' }, comment: 'a'.repeat(4001) },
    { intent: 'review' },
  ])
    assert.throws(() => store.addDraft(id, { revision: 'v1', item }));
  assert.throws(
    () =>
      store.addDraft(id, {
        ...comment(),
        item: { ...comment().item, target: { selector: 'h1', revision: 'v0' } },
      }),
    /Target revision/,
  );
  assert.throws(() => parseJson('{"__proto__":{"x":1}}'));
  assert.throws(() => parseJson('['.repeat(30) + ']'.repeat(30)));
  assert.equal(store.get(id).drafts.length, 0);
});
test('drafts persist, and send turns them into one event', () => {
  const { store, id, dir } = setup();
  store.addDraft(id, comment());
  store.setMessage(id, 'Keep changes small.');
  assert.equal(new Store(dir).get(id).drafts.length, 1);
  const event = store.send(id, 'v1');
  assert.equal(event.message, 'Keep changes small.');
  assert.equal(event.items[0].comment, 'Review this');
  assert.equal(event.revision, 'v1');
  const restarted = new Store(dir).get(id);
  assert.deepEqual(
    [restarted.drafts, restarted.message, restarted.events.length],
    [[], '', 1],
  );
  assert.throws(() => store.send(id, 'v1'), /Add feedback/);
});
test('a revision change refuses new input and blocks stale drafts', () => {
  const { store, id } = setup();
  store.addDraft(id, comment());
  store.setRevision(id, 'v2');
  assert.throws(() => store.addDraft(id, comment()), /page changed/);
  assert.throws(() => store.send(id, 'v1'), /page changed/);
  assert.throws(() => store.send(id, 'v2'), /another revision/);
  store.removeDraft(id, store.get(id).drafts[0].item.id);
  assert.equal(queue(store, id).revision, 'v2');
});
test('edits keep the item ID, target, and original text', () => {
  const { store, id } = setup();
  const draftId = store.addDraft(id, {
    revision: 'v1',
    item: {
      target: { selector: 'p' },
      replacement: { before: 'Old', after: 'New' },
    },
    marker: { x: 1, y: 2 },
  });
  store.editDraft(id, draftId, {
    revision: 'v1',
    comment: 'Why',
    after: 'Newer',
  });
  const [draft] = store.get(id).drafts;
  assert.equal(draft.item.id, draftId);
  assert.deepEqual(draft.item.replacement, { before: 'Old', after: 'Newer' });
  assert.equal(draft.item.comment, 'Why');
  assert.deepEqual(draft.marker, { x: 1, y: 2 });
  const note = store.addDraft(id, comment());
  assert.throws(
    () =>
      store.editDraft(id, note, { revision: 'v1', comment: 'x', after: 'y' }),
    /not a replacement/,
  );
  assert.throws(
    () => store.editDraft(id, note, { revision: 'v1', comment: '' }),
    /needs a comment/,
  );
});
test('form values persist per form', () => {
  const { store, id, dir } = setup();
  store.saveForm(id, 'plan', { approach: 'pilot' });
  store.saveForm(id, 'other', { x: true });
  assert.deepEqual(new Store(dir).get(id).forms, {
    plan: { approach: 'pilot' },
    other: { x: true },
  });
  assert.throws(() => store.saveForm(id, '__proto__', {}), /Reserved/);
});
test('receipt completes only leased events, not newer input', () => {
  const { store, id } = setup();
  queue(store, id);
  const batch = store.take(id, 'agent');
  assert.ok(batch?.status === 'feedback');
  queue(store, id, 'two');
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
  queue(store, id);
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
  queue(store, id);
  const batch = store.take(id, 'agent');
  assert.ok(batch?.status === 'feedback');
  const resumed = new Store(dir);
  assert.throws(() => resumed.take(id, 'other'), /leased/);
  resumed.acknowledge(id, batch.receipt);
  assert.equal(resumed.get(id).events[0].status, 'completed');
});
test('renewal validates receipt and extends its lease', () => {
  const { store, id } = setup();
  queue(store, id);
  const batch = store.take(id, 'agent', 1000);
  assert.ok(batch?.status === 'feedback');
  assert.throws(() => store.renew(id, undefined));
  store.renew(id, batch.receipt, 10000);
  assert.ok(store.get(id).lease!.expiresAt > batch.leaseExpiresAt);
});
test('ending a session rejects writes but delivers previously queued work', () => {
  const { store, id } = setup();
  queue(store, id);
  store.end(id);
  assert.throws(() => store.addDraft(id, comment()), /ended/);
  assert.throws(() => store.setMessage(id, 'new'), /ended/);
  assert.throws(() => store.saveForm(id, 'plan', {}), /ended/);
  const batch = store.take(id, 'agent');
  assert.ok(batch?.status === 'feedback');
  store.acknowledge(id, batch.receipt);
  assert.equal(store.take(id, 'agent')?.status, 'ended');
});
test('session writes leave other session files untouched', () => {
  const { dir, store, id } = setup();
  const other = store.open(
    { kind: 'file', value: '/tmp/b.html', root: '/tmp', network: false },
    'v2',
  );
  const file = path.join(dir, 'sessions', `${other.id}.json`);
  const before = fs.statSync(file, { bigint: true });
  queue(store, id);
  assert.equal(fs.statSync(file, { bigint: true }).mtimeNs, before.mtimeNs);
  const restarted = new Store(dir);
  assert.equal(restarted.get(id).events.length, 1);
  assert.equal(restarted.get(other.id).events.length, 0);
});
test('a corrupt or unsupported session does not hide other sessions', () => {
  const { dir, store, id } = setup();
  const other = store.open(
    { kind: 'file', value: '/tmp/b.html', root: '/tmp', network: false },
    'v2',
  );
  const corrupt = path.join(dir, 'sessions', `${id}.json`);
  for (const content of [
    'invalid',
    JSON.stringify({ format: 1, session: store.get(id) }),
    JSON.stringify({
      format: 2,
      session: {
        ...store.get(id),
        target: { kind: 'url', value: 'invalid', network: true },
      },
    }),
    JSON.stringify({ format: 2, session: { ...store.get(id), drafts: {} } }),
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
