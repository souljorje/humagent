import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { textDiff } from '../dist/ui/text-diff.js';

test('diffs reconstruct exact originals and proposals across edge cases', () => {
  for (const [before, after] of [
    ['', 'New text'],
    ['Removed text', ''],
    ['', ''],
    ['Same', 'Same'],
    ['a b a c', 'a c a b'],
    ['a\nb  c', 'a b\nc'],
    ['Hello, 世界 👩🏽‍💻!', 'Hello, мир 👨‍💻!'],
    ['First old and second old.', 'First new and second new.'],
    ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>'],
    ['old '.repeat(1500), 'new '.repeat(1500)],
  ]) {
    const diff = textDiff(before!, after!);
    assert.equal(
      diff
        .filter((p) => p.kind !== 'add')
        .map((p) => p.text)
        .join(''),
      before,
    );
    assert.equal(
      diff
        .filter((p) => p.kind !== 'remove')
        .map((p) => p.text)
        .join(''),
      after,
    );
  }
  for (const [before, after] of [
    ['A page that was already here.', 'Raz dva tri'],
    ['Hello, world', 'One, two'],
  ])
    assert.deepEqual(textDiff(before!, after!), [
      { kind: 'remove', text: before },
      { kind: 'add', text: after },
    ]);
  assert.deepEqual(textDiff('a b c d', 'd e f g'), [
    { kind: 'remove', text: 'a b c ' },
    { kind: 'same', text: 'd' },
    { kind: 'add', text: ' e f g' },
  ]);
});
