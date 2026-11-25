/** Checks of untrusted input. The server, the workspace, and the plugins share them. */
import { LIMITS, type Target } from './feedback.js';
import type { ObjectValue } from './json.js';

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
export interface Envelope {
  kind: string;
  comment?: string;
  data?: unknown;
  target?: Target;
}
const REVIEW_FIELDS = new Set(['kind', 'comment', 'data', 'target']);
/**
 * Check the fields that every review shares. No rule here depends on the kind.
 * Blank comments are dropped.
 */
export function envelope(value: unknown): Envelope {
  object(value, 'Review');
  for (const key of Object.keys(value))
    ensure(REVIEW_FIELDS.has(key), `Unsupported review field: ${key}`);
  const kind = text(value.kind, 'Review kind', LIMITS.key);
  ensure(/^[a-z][a-z0-9-]*$/.test(kind), 'Invalid review kind');
  const result: Envelope = { kind };
  if (value.comment !== undefined) {
    const comment = text(value.comment, 'Comment', LIMITS.comment, true);
    if (comment.trim()) result.comment = comment;
  }
  if (value.data !== undefined) result.data = value.data;
  if (value.target !== undefined) {
    object(value.target, 'Target');
    result.target = value.target as Target;
  }
  return result;
}
