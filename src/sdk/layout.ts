/** Pure placement rules for markers and the editor. All values are CSS pixels in the viewport. */
import type { MarkerPosition } from '../shared/feedback.js';

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Box extends Size {
  left: number;
  top: number;
  bottom: number;
}
const MARGIN = 12;
const GAP = 10;
const MARKER = 32;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

/** Whether part of a nonempty box is in the viewport height. */
export function inView(box: Box, viewportHeight: number) {
  return (
    !!(box.width || box.height) && box.bottom >= 0 && box.top <= viewportHeight
  );
}
/**
 * A marker sits at the caret of a text edit, at its saved offset, or at the target center.
 * Text-edit markers stay inside the viewport.
 */
export function markerPoint(
  target: Box,
  marker: MarkerPosition | undefined,
  caret: Point | undefined,
  viewport: Size,
): Point {
  const offset = marker || { x: target.width / 2, y: target.height / 2 };
  const point = caret || {
    x: target.left + offset.x,
    y: target.top + offset.y,
  };
  if (marker?.textOffset === undefined) return point;
  return {
    x: clamp(point.x, MARGIN, viewport.width - MARGIN - MARKER),
    y: clamp(point.y, MARGIN, viewport.height - MARGIN - MARKER),
  };
}
/** The editor opens after its anchor point, flips when it does not fit, and stays inside the viewport. */
export function panelPoint(point: Point, panel: Size, viewport: Size): Point {
  const along = (start: number, size: number, limit: number) =>
    clamp(
      start + GAP + size <= limit - MARGIN ? start + GAP : start - size - GAP,
      MARGIN,
      limit - size - MARGIN,
    );
  return {
    x: along(point.x, panel.width, viewport.width),
    y: along(point.y, panel.height, viewport.height),
  };
}
