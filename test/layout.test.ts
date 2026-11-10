import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { inView, markerPoint, panelPoint } from '../dist/sdk/layout.js';

const viewport = { width: 1000, height: 800 };
const box = (left: number, top: number, width = 100, height = 40) => ({
  left,
  top,
  width,
  height,
  bottom: top + height,
});

test('only nonempty boxes inside the viewport height are in view', () => {
  assert.equal(inView(box(0, 100), 800), true);
  assert.equal(inView(box(0, -30), 800), true);
  assert.equal(inView(box(0, -50), 800), false);
  assert.equal(inView(box(0, 801), 800), false);
  assert.equal(inView(box(0, 100, 0, 0), 800), false);
});

test('markers sit at the saved click offset, or at the target center', () => {
  const target = box(100, 200);
  assert.deepEqual(markerPoint(target, undefined), { x: 150, y: 220 });
  assert.deepEqual(markerPoint(target, { x: 5, y: 6 }), { x: 105, y: 206 });
  // A target that shrank after the click keeps its marker on its edge.
  assert.deepEqual(markerPoint(target, { x: 500, y: 90 }), { x: 200, y: 240 });
});

test('the editor opens after its anchor and flips when it does not fit', () => {
  const panel = { width: 300, height: 200 };
  assert.deepEqual(panelPoint({ x: 100, y: 100 }, panel, viewport), {
    x: 110,
    y: 110,
  });
  assert.deepEqual(panelPoint({ x: 900, y: 700 }, panel, viewport), {
    x: 590,
    y: 490,
  });
  assert.deepEqual(
    panelPoint({ x: 100, y: 100 }, panel, { width: 200, height: 150 }),
    { x: 12, y: 12 },
  );
});
