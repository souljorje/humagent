/** Pure placement rules for markers and the editor. All values are CSS pixels in the viewport. */
import type { MarkerPosition } from '@/shared/marker';

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
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

/** Whether part of a nonempty box is in the viewport height. */
export function inView(box: Box, viewportHeight: number) {
  return (
    !!(box.width || box.height) && box.bottom >= 0 && box.top <= viewportHeight
  );
}
/** A marker sits where the human clicked, or at the center. It stays inside a target that shrank. */
export function markerPoint(
  target: Box,
  marker: MarkerPosition | undefined,
): Point {
  const offset = marker || { x: target.width / 2, y: target.height / 2 };
  return {
    x: target.left + clamp(offset.x, 0, target.width),
    y: target.top + clamp(offset.y, 0, target.height),
  };
}
/** The position on one axis: after the start, or before it when it does not fit. */
function along(start: number, size: number, limit: number) {
  const after = start + GAP;
  const fits = after + size <= limit - MARGIN;
  return clamp(
    fits ? after : start - size - GAP,
    MARGIN,
    limit - size - MARGIN,
  );
}
/** The editor opens after its anchor point, flips when it does not fit, and stays inside the viewport. */
export function panelPoint(
  point: Point,
  panel: Size,
  viewport: Size,
  bar?: Point,
): Point {
  const x = along(point.x, panel.width, viewport.width);
  const y = along(point.y, panel.height, viewport.height);
  const reachesBar =
    bar && x + panel.width + GAP > bar.x && y + panel.height + GAP > bar.y;
  if (!reachesBar) return { x, y };
  // Beside the bar, or above it when there is no room.
  return bar.x >= panel.width + MARGIN + GAP
    ? { x: bar.x - panel.width - GAP, y }
    : { x, y: Math.max(MARGIN, bar.y - panel.height - GAP) };
}
