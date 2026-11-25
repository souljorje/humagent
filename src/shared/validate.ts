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
  readonly kind: string;
  readonly comment?: string;
  readonly data?: unknown;
  readonly target?: Target;
}
const REVIEW_FIELDS = new Set(['kind', 'comment', 'data', 'target']);
/**
 * Check the fields that every review shares. No rule here depends on the kind.
 * Blank comments are dropped.
 */
export function envelope(value: unknown): Envelope {
  object(value, 'Review');
  const unsupported = Object.keys(value).find((key) => !REVIEW_FIELDS.has(key));
  ensure(unsupported === undefined, `Unsupported review field: ${unsupported}`);
  const kind = text(value.kind, 'Review kind', LIMITS.key);
  ensure(/^[a-z][a-z0-9-]*$/.test(kind), 'Invalid review kind');
  const comment =
    value.comment === undefined
      ? undefined
      : text(value.comment, 'Comment', LIMITS.comment, true);
  const { data, target } = value;
  if (target !== undefined) object(target, 'Target');
  return {
    kind,
    ...(comment?.trim() ? { comment } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(target !== undefined ? { target } : {}),
  };
}
