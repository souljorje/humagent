import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createReview } from '../dist/ui/review-state.js';
import { batch } from '../dist/shared/batch.js';
import type { Input } from '../dist/shared/batch.js';
import type { Json } from '../dist/shared/json.js';

function storage() {
  const values = new Map<string, string>();
  return {
    fail: false,
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      if (this.fail) throw new Error('Quota exceeded');
      values.set(key, value);
    },
  };
}
const decision = (value: Json) => ({ intent: 'review', values: { value } });
const accepted = (value: Input) => ({
  ...value,
  id: 'stored-event',
  status: 'queued',
});
test('SDK staging persists before acknowledgment and deduplicates the same request after reload', () => {
  const saved = storage();
  const review = createReview(saved, 'session');
  const first = review.stage(decision(1), 'revision', 'request');
  assert.equal(first.status, 'draft');
  const resumed = createReview(saved, 'session');
  assert.deepEqual(resumed.stage(decision(1), 'revision', 'request'), first);
  assert.equal(resumed.snapshot().drafts.length, 1);
  assert.throws(
    () => resumed.stage(decision(2), 'revision', 'request'),
    /reused/,
  );
  assert.notEqual(
    resumed.stage(decision(1), 'revision', 'another').draftId,
    first.draftId,
  );
});
test('failed storage does not acknowledge or mutate a staged draft', () => {
  const saved = storage(),
    review = createReview(saved, 's');
  saved.fail = true;
  assert.throws(() => review.stage(decision(1), 'revision'), /Quota/);
  assert.deepEqual(review.snapshot().drafts, []);
  saved.fail = false;
  assert.deepEqual(createReview(saved, 's').snapshot().drafts, []);
});
test('sending locks its snapshot and preserves new drafts and edited overall instructions', async () => {
  const review = createReview(storage(), 's');
  const first = review.stage(decision(1), 'revision');
  review.setMessage('First instruction', 'revision');
  const clientId = review.begin('revision');
  assert.throws(
    () => review.edit(first.draftId, { id: first.draftId, ...decision(2) }),
    /unconfirmed/,
  );
  assert.throws(() => review.remove(first.draftId), /unconfirmed/);
  assert.throws(() => review.begin('revision'), /Add feedback/);
  review.stage(decision(3), 'revision');
  review.setMessage('New instruction', 'revision');
  let sent!: Input;
  await review.deliver(clientId, async (value) => {
    sent = value;
    return accepted(value);
  });
  assert.equal(sent.payload.items.length, 1);
  assert.equal(sent.payload.message, 'First instruction');
  assert.equal(review.snapshot().drafts[0].item.values!.value, 3);
  assert.equal(review.snapshot().message.text, 'New instruction');
  assert.equal(review.snapshot().outbox.length, 0);
});
test('a lost response retries the exact batch across reload', async () => {
  const saved = storage(),
    review = createReview(saved, 's'),
    requests: Input[] = [];
  review.stage(decision(1), 'revision');
  const clientId = review.begin('revision');
  await assert.rejects(
    review.deliver(clientId, async (value) => {
      requests.push(value);
      throw new Error('Connection lost');
    }),
  );
  const resumed = createReview(saved, 's');
  await resumed.deliver(clientId, async (value) => {
    requests.push(value);
    return accepted(value);
  });
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(resumed.snapshot().drafts.length, 0);
});
test('a later rejection cannot unlock an earlier uncertain batch', async () => {
  const review = createReview(storage(), 's');
  review.stage(decision(1), 'revision');
  const clientId = review.begin('revision');
  await assert.rejects(
    review.deliver(clientId, async () => {
      throw new Error('Lost response');
    }),
  );
  await assert.rejects(
    review.deliver(clientId, async () => {
      throw Object.assign(new Error('Unauthorized'), { rejected: true });
    }),
  );
  assert.throws(() => review.release(clientId), /Retry unconfirmed/);
});
test('a confirmed initial rejection can return feedback to drafts without rewriting its revision', async () => {
  const review = createReview(storage(), 's');
  review.stage(decision(1), 'old');
  const clientId = review.begin('old');
  await assert.rejects(
    review.deliver(clientId, async () => {
      throw Object.assign(new Error('Stale'), { rejected: true });
    }),
  );
  review.release(clientId);
  assert.throws(() => review.begin('new'), /another revision/);
  assert.equal(review.snapshot().drafts[0].revision, 'old');
});
test('failed confirmation persistence keeps input available for an idempotent retry', async () => {
  const saved = storage(),
    review = createReview(saved, 's');
  review.stage(decision(1), 'revision');
  const clientId = review.begin('revision');
  await assert.rejects(
    review.deliver(clientId, async (value) => {
      saved.fail = true;
      return accepted(value);
    }),
    /Quota/,
  );
  assert.equal(review.snapshot().drafts.length, 1);
  assert.equal(review.snapshot().outbox.length, 1);
  saved.fail = false;
  await createReview(saved, 's').deliver(clientId, async (value) =>
    accepted(value),
  );
  assert.equal(createReview(saved, 's').snapshot().drafts.length, 0);
});
test('batch validation preserves exact replacements and rejects empty, mixed, duplicate, or oversized input', () => {
  const value = {
    protocol: 2,
    clientId: 'batch',
    revision: 'r',
    payload: {
      items: [
        {
          id: 'one',
          target: { selector: 'h1', revision: 'r' },
          replacement: { before: ' Original\ntext ', after: '' },
        },
      ],
    },
  };
  assert.deepEqual(batch(value), value);
  for (const payload of [
    { items: [] },
    { items: [value.payload.items[0], value.payload.items[0]] },
    { items: [{ id: 'empty', target: {} }] },
    { items: [{ ...value.payload.items[0], target: { revision: 'other' } }] },
    {
      items: Array.from({ length: 101 }, (_, id) => ({
        id: String(id),
        ...decision(id),
      })),
    },
  ]) {
    assert.throws(() => batch({ ...value, payload }));
  }
  assert.throws(
    () =>
      batch({
        ...value,
        payload: { items: [{ id: 'big', ...decision('a'.repeat(300000)) }] },
      }),
    /256/,
  );
});
test('editing preserves creation order and identities', () => {
  const review = createReview(storage(), 's');
  const one = review.stage(decision(1), 'r');
  const two = review.stage(decision(2), 'r');
  review.edit(two.draftId, { id: two.draftId, ...decision(3) });
  assert.deepEqual(
    review.snapshot().drafts.map((d) => d.item.id),
    [one.draftId, two.draftId],
  );
  review.remove(one.draftId);
  assert.equal(review.snapshot().drafts.length, 1);
});

test('marker presentation persists without entering the submitted payload', () => {
  const saved = storage(),
    review = createReview(saved, 'markers');
  const staged = review.stage(decision(1), 'r', 'marker-request', {
    x: 13,
    y: -24,
  });
  const resumed = createReview(saved, 'markers');
  assert.deepEqual(resumed.snapshot().drafts[0].marker, { x: 13, y: -24 });
  assert.deepEqual(
    resumed.stage(decision(1), 'r', 'marker-request', { x: 13, y: -24 }),
    staged,
  );
  assert.throws(
    () => resumed.stage(decision(1), 'r', 'marker-request', { x: 4, y: 5 }),
    /reused/,
  );
  assert.throws(
    () => resumed.stage(decision(1), 'r', 'invalid', { x: Infinity, y: 0 }),
    /marker/,
  );
  resumed.edit(staged.draftId, { id: staged.draftId, ...decision(2) });
  assert.deepEqual(resumed.snapshot().drafts[0].marker, { x: 13, y: -24 });
  assert.throws(
    () =>
      resumed.edit(
        staged.draftId,
        { id: staged.draftId, ...decision(2) },
        { x: NaN, y: 0 },
      ),
    /marker/,
  );
  resumed.edit(
    staged.draftId,
    { id: staged.draftId, ...decision(2) },
    { x: 42, y: 80 },
  );
  assert.deepEqual(createReview(saved, 'markers').snapshot().drafts[0].marker, {
    x: 42,
    y: 80,
  });
  resumed.begin('r');
  assert.equal(
    'marker' in resumed.snapshot().outbox[0].batch.payload.items[0],
    false,
  );
});

test('reloading during a rejected-batch retry does not permit a new client ID', async () => {
  const saved = storage(),
    review = createReview(saved, 's');
  review.stage(decision(1), 'r');
  const id = review.begin('r');
  await assert.rejects(
    review.deliver(id, async () => {
      throw Object.assign(new Error('Rejected'), { rejected: true });
    }),
  );
  let finish!: () => void;
  const retry = review.deliver(
    id,
    (value) =>
      new Promise((resolve) => {
        finish = () => resolve(accepted(value));
      }),
  );
  assert.throws(
    () => createReview(saved, 's').release(id),
    /Retry unconfirmed/,
  );
  finish();
  await retry;
});

test('returning rejected input cannot overwrite a newer instruction or lose the old one', async () => {
  const review = createReview(storage(), 's');
  review.setMessage('Original instruction', 'r');
  const id = review.begin('r');
  review.setMessage('New instruction', 'r');
  await assert.rejects(
    review.deliver(id, async () => {
      throw Object.assign(new Error('Rejected'), { rejected: true });
    }),
  );
  assert.throws(() => review.release(id), /newer overall instruction/);
  assert.equal(
    review.snapshot().outbox[0].batch.payload.message,
    'Original instruction',
  );
  review.setMessage('', 'r');
  review.release(id);
  assert.equal(review.snapshot().message.text, 'Original instruction');
});

test('storage wrappers do not reduce the supported wire nesting depth', async () => {
  const saved = storage(),
    review = createReview(saved, 's');
  let value: Json = 'leaf';
  for (let i = 0; i < 17; i++) value = { child: value };
  review.stage(decision(value), 'r');
  const id = review.begin('r');
  assert.equal(review.snapshot().outbox.length, 1);
  const resumed = createReview(saved, 's');
  await resumed.deliver(id, async (value) => accepted(value));
  assert.equal(resumed.snapshot().outbox.length, 0);
});
