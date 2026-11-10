import { cloneJson, type ObjectValue } from '../shared/json.js';
import {
  LIMITS,
  type DraftItem,
  type DraftLabels,
  type MarkerPosition,
} from '../shared/feedback.js';

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
export function text(
  value: unknown,
  name: string,
  limit: number,
  allowEmpty = false,
): asserts value is string {
  ensure(
    typeof value === 'string' &&
      (allowEmpty || value.trim().length > 0) &&
      value.length <= limit,
    `${name} must be ${allowEmpty ? 0 : 1}–${limit} characters`,
  );
}
/** Targets must be explicit HTTP loopback addresses without credentials. */
export function localUrl(url: URL) {
  return (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    !url.username &&
    !url.password
  );
}
/** Parse untrusted JSON into plain data. `cloneJson` rejects deep nesting and reserved keys. */
export function parseJson(source: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Failure(400, 'INVALID_JSON', 'Malformed JSON');
  }
  try {
    return cloneJson(value);
  } catch (error) {
    throw new Failure(400, 'INVALID_INPUT', (error as Error).message);
  }
}

const ITEM_FIELDS = new Set([
  'target',
  'comment',
  'replacement',
  'intent',
  'values',
]);
export function item(value: unknown): DraftItem {
  object(value, 'Item');
  for (const key of Object.keys(value))
    ensure(ITEM_FIELDS.has(key), `Unsupported item field: ${key}`);
  const { target, comment, replacement, intent, values } = value;
  const result: DraftItem = {};
  if (target !== undefined) {
    object(target, 'Target');
    result.target = target;
  }
  if (comment !== undefined) {
    text(comment, 'Comment', LIMITS.comment, true);
    result.comment = comment;
  }
  if (replacement !== undefined) {
    object(replacement, 'Replacement');
    ensure(target, 'A replacement requires a target');
    text(replacement.before, 'Original text', LIMITS.text);
    text(replacement.after, 'Replacement', LIMITS.text, true);
    result.replacement = {
      before: replacement.before,
      after: replacement.after,
    };
  }
  if (intent !== undefined || values !== undefined) {
    text(intent, 'Intent', LIMITS.intent);
    object(values, 'Values');
    result.intent = intent;
    result.values = values;
  }
  ensure(
    (result.target && (result.comment?.trim() || result.replacement)) ||
      result.intent,
    'Each item needs a comment, replacement, or structured decision',
  );
  return result;
}
export function marker(value: unknown): MarkerPosition | undefined {
  if (value === undefined) return undefined;
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
export function labels(value: unknown): DraftLabels | undefined {
  if (value === undefined) return undefined;
  object(value, 'Labels');
  text(value.title, 'Form title', LIMITS.label);
  const { fields } = value;
  ensure(
    Array.isArray(fields) && fields.length <= LIMITS.labelFields,
    `Labels support at most ${LIMITS.labelFields} fields`,
  );
  return {
    title: value.title,
    fields: fields.map((field) => {
      object(field, 'Field label');
      text(field.label, 'Field label', LIMITS.label);
      text(field.value, 'Field value', LIMITS.label, true);
      return { label: field.label, value: field.value };
    }),
  };
}
