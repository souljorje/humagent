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

test('items and drafts validate, persist, and edit in place', () => {
  const { store, id, dir } = setup();
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
  const note = store.addDraft(id, {
    revision: 'v1',
    item: { target, comment: 'Here' },
  });
  const [decision, saved] = store.get(id).drafts;
  assert.deepEqual(decision.item.values, { priority: 2 });
  assert.deepEqual(saved.item.target, target);

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
  const edited = store.get(id).drafts[2];
  assert.equal(edited.item.id, draftId);
  assert.deepEqual(edited.item.replacement, { before: 'Old', after: 'Newer' });
  assert.equal(edited.item.comment, 'Why');
  assert.deepEqual(edited.marker, { x: 1, y: 2 });
  assert.throws(
    () =>
      store.editDraft(id, note, { revision: 'v1', comment: 'x', after: 'y' }),
    /not a replacement/,
  );
  assert.throws(
    () => store.editDraft(id, note, { revision: 'v1', comment: '' }),
    /needs a comment/,
  );

  store.setMessage(id, 'Keep changes small.');
  assert.equal(new Store(dir).get(id).drafts.length, 3);
  const event = store.send(id, 'v1');
  assert.equal(event.message, 'Keep changes small.');
  assert.deepEqual(
    event.items.map((item) => item.comment),
    [undefined, 'Here', 'Why'],
  );
  assert.equal(event.revision, 'v1');
  const restarted = new Store(dir).get(id);
  assert.deepEqual(
    [restarted.drafts, restarted.message, restarted.events.length],
    [[], '', 1],
  );
  assert.throws(() => store.send(id, 'v1'), /Add feedback/);

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
  const forms = new Store(dir).get(id).drafts;
  assert.equal(forms.length, 2);
  assert.equal(forms[0].item.id, first);
  assert.deepEqual(forms[0].item.values, { approach: 'platform' });
  assert.deepEqual(forms[0].labels!.fields, [
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
test('revisions guard input and receipts control delivery', () => {
  const { store, id, dir } = setup();
  store.addDraft(id, comment());
  store.setRevision(id, 'v2');
  assert.throws(() => store.addDraft(id, comment()), /page changed/);
  assert.throws(() => store.send(id, 'v1'), /page changed/);
  assert.throws(() => store.send(id, 'v2'), /another revision/);
  store.removeDraft(id, store.get(id).drafts[0].item.id);
  assert.equal(queue(store, id).revision, 'v2');

  // A receipt completes only its delivered events, not newer input.
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

  // Unacknowledged events come back with a new receipt, also after a restart.
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
  assert.equal(resumed.get(id).events[1].status, 'completed');

  // Ending rejects writes but still delivers previously queued work.
  queue(resumed, id, 'three');
  resumed.end(id);
  assert.throws(
    () => resumed.addDraft(id, { ...comment(), revision: 'v2' }),
    /ended/,
  );
  assert.throws(() => resumed.setMessage(id, 'new'), /ended/);
  const last = resumed.take(id);
  assert.ok(last?.status === 'feedback');
  assert.equal(last.events[0].message, 'three');
  resumed.acknowledge(id, last.receipt);
  assert.equal(resumed.take(id)?.status, 'ended');
  assert.throws(() => resumed.acknowledge(id, undefined), /unknown/);
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
