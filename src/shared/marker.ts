/** Where the human clicked, relative to the target's top-left corner. */
export type MarkerPosition = { x: number; y: number };
export function isMarkerPosition(value: unknown): value is MarkerPosition {
  return (
    value !== null &&
    typeof value === 'object' &&
    'x' in value &&
    Number.isFinite(value.x) &&
    'y' in value &&
    Number.isFinite(value.y)
  );
}
