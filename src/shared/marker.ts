/** The private pending review data of reviews that have a target. */
import { ensure, object } from './validate.js';

/** Where the human clicked, relative to the target's top-left corner. */
export type MarkerPosition = { x: number; y: number };
export type MarkerLocal = { marker: MarkerPosition };
export function markerPosition(value: unknown): MarkerPosition {
  object(value, 'Marker');
  const { x, y } = value;
  ensure(
    typeof x === 'number' &&
      typeof y === 'number' &&
      Number.isFinite(x) &&
      Number.isFinite(y),
    'Invalid marker position',
  );
  return { x, y };
}
