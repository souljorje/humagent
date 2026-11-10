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

test('markers use the caret, then the saved offset, then the target center', () => {
  const target = box(100, 200);
  assert.deepEqual(markerPoint(target, undefined, undefined, viewport), {
    x: 150,
    y: 220,
  });
  assert.deepEqual(markerPoint(target, { x: 5, y: 6 }, undefined, viewport), {
    x: 105,
    y: 206,
  });
  assert.deepEqual(
    markerPoint(target, { x: 5, y: 6 }, { x: 400, y: 300 }, viewport),
    { x: 400, y: 300 },
  );
});

test('only text-edit markers stay inside the viewport', () => {
  const offscreen = { x: 1200, y: -40 };
  assert.deepEqual(
    markerPoint(box(0, 0), { x: 0, y: 0, textOffset: 3 }, offscreen, viewport),
    { x: 956, y: 12 },
  );
  assert.deepEqual(
    markerPoint(box(0, 0), { x: 0, y: 0 }, offscreen, viewport),
    offscreen,
  );
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
