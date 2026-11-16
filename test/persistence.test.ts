import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixtures.ts';
import path from 'node:path';
import { Store } from '../dist/runtime/store.js';

test('a corrupt or unsupported session does not hide other sessions', () => {
  const dir = fixture('persistence');
  try {
    const store = new Store(dir);
    const { id } = store.open(
      { kind: 'file', value: '/tmp/a.html', root: '/tmp', network: false },
      'v1',
    );
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
