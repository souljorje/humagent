import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { textDiff } from '../dist/ui/text-diff.js';

test('a text diff reconstructs the exact original and the exact proposal', () => {
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
    const join = (omit: string) =>
      diff
        .filter((part) => part.kind !== omit)
        .map((part) => part.text)
        .join('');
    assert.equal(join('add'), before);
    assert.equal(join('remove'), after);
  }
  // Texts with little in common show as one removal and one addition.
  assert.deepEqual(textDiff('Hello, world', 'One, two'), [
    { kind: 'remove', text: 'Hello, world' },
    { kind: 'add', text: 'One, two' },
  ]);
  assert.deepEqual(textDiff('a b c d', 'd e f g'), [
    { kind: 'remove', text: 'a b c ' },
    { kind: 'same', text: 'd' },
    { kind: 'add', text: ' e f g' },
  ]);
});
