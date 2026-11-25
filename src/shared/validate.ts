/** Checks of untrusted input. The server, the workspace, and the plugins share them. */
import { LIMITS, type NewReview } from './feedback';
import type { Json, ObjectValue } from './json';

export class Failure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'Failure';
  }
}
export function ensure(
  value: unknown,
  message: string,
  code = 'INVALID_INPUT',
  status = 400,
): asserts value {
  if (!value) throw new Failure(status, code, message);
}
export function object(
  value: unknown,
  name = 'Value',
): asserts value is ObjectValue {
  ensure(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${name} must be an object`,
  );
}
/** Return `value` when it is text within the length limit. */
export function text(
  value: unknown,
  name: string,
  limit: number,
  allowEmpty = false,
): string {
  ensure(
    typeof value === 'string' &&
      (allowEmpty || value.trim().length > 0) &&
      value.length <= limit,
    `${name} must be ${allowEmpty ? 0 : 1}–${limit} characters`,
  );
  return value;
}

/** A review after the envelope check. `data` is still unchecked JSON. */
export type Envelope<Data = unknown> = Omit<NewReview, 'data'> & {
  readonly data?: Data;
};
const REVIEW_FIELDS = new Set(['kind', 'comment', 'data', 'target']);
export function reviewComment(value: unknown) {
  const comment = text(value, 'Comment', LIMITS.comment, true);
  return comment.trim() ? comment : undefined;
}
/** Omit absent fields and keep the review's wire order. */
export function reviewFields<Data>({
  kind,
  comment,
  data,
  target,
}: Envelope<Data>) {
  return {
    kind,
    ...(comment ? { comment } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(target ? { target } : {}),
  };
}
/**
 * Check the fields that every review shares. No rule here depends on the kind.
 * Blank comments are dropped.
 */
export function envelope(value: Json | undefined): NewReview;
export function envelope(value: unknown): Envelope;
export function envelope(value: unknown): Envelope {
  object(value, 'Review');
  const unsupported = Object.keys(value).find((key) => !REVIEW_FIELDS.has(key));
  ensure(unsupported === undefined, `Unsupported review field: ${unsupported}`);
  const { kind, data, target } = value;
  ensure(
    typeof kind === 'string' &&
      kind.length <= LIMITS.key &&
      /^[a-z][a-z0-9-]*$/.test(kind),
    'Invalid review kind',
  );
  const comment =
    value.comment === undefined ? undefined : reviewComment(value.comment);
  if (target !== undefined) object(target, 'Target');
  return reviewFields({ kind, comment, data, target });
}
