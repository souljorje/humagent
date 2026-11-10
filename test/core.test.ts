import { test, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixtures.ts';
import path from 'node:path';
import { Store } from '../dist/runtime/store.js';
import { parseJson } from '../dist/runtime/validate.js';
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
test('a form key keeps one draft and replaces it in place', () => {
  const { store, id, dir } = setup();
  const form = (approach: string, revision = 'v1') => ({
    revision,
    key: 'plan',
    item: { intent: 'revise_plan', values: { approach } },
    labels: {
      title: 'Plan',
      fields: [{ label: 'Approach', value: approach }],
    },
  });
  const first = store.addDraft(id, form('pilot'));
  store.addDraft(id, comment());
  assert.equal(store.addDraft(id, form('platform')), first);
  const saved = new Store(dir).get(id).drafts;
  assert.equal(saved.length, 2);
  assert.equal(saved[0].item.id, first);
  assert.deepEqual(saved[0].item.values, { approach: 'platform' });
  assert.deepEqual(saved[0].labels!.fields, [
    { label: 'Approach', value: 'platform' },
  ]);
  store.setRevision(id, 'v2');
  assert.equal(store.addDraft(id, form('later', 'v2')), first);
  assert.equal(store.get(id).drafts[0].revision, 'v2');
  assert.throws(
    () => store.addDraft(id, { ...form('x', 'v2'), labels: { title: '' } }),
    /Form title/,
  );
});
test('a receipt completes only its delivered events, not newer input', () => {
  const { store, id } = setup();
  queue(store, id);
  const batch = store.take(id);
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
test('unacknowledged events come back with a new receipt, also after a restart', () => {
  const { store, id, dir } = setup();
  queue(store, id);
  const first = store.take(id);
  assert.ok(first?.status === 'feedback');
  const second = new Store(dir).take(id);
  assert.ok(second?.status === 'feedback');
  assert.equal(second.events[0].id, first.events[0].id);
  assert.equal(second.events[0].deliveries, 2);
  const resumed = new Store(dir);
  assert.throws(() => resumed.acknowledge(id, first.receipt), /replaced/);
  assert.throws(() => resumed.acknowledge(id, undefined), /unknown/);
  resumed.acknowledge(id, second.receipt);
  assert.equal(resumed.get(id).events[0].status, 'completed');
});
test('ending a session rejects writes but delivers previously queued work', () => {
  const { store, id } = setup();
  queue(store, id);
  store.end(id);
  assert.throws(() => store.addDraft(id, comment()), /ended/);
  assert.throws(() => store.setMessage(id, 'new'), /ended/);
  const batch = store.take(id);
  assert.ok(batch?.status === 'feedback');
  store.acknowledge(id, batch.receipt);
  assert.equal(store.take(id)?.status, 'ended');
  assert.throws(() => store.acknowledge(id, undefined), /unknown/);
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
