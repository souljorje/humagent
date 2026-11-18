import { cloneJson, type ObjectValue } from '../shared/json.js';
import {
  LIMITS,
  type DraftLabels,
  type MarkerPosition,
  type ReviewItem,
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
/** Sources must be explicit HTTP loopback addresses without credentials. */
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

const ITEM_FIELDS = new Set(['comment', 'edit', 'form', 'target']);
/** Derive `kind` from the content key. A form item takes no edit or target. Blank comments are dropped. */
export function item(value: unknown, id: string): ReviewItem {
  object(value, 'Item');
  for (const key of Object.keys(value))
    ensure(ITEM_FIELDS.has(key), `Unsupported item field: ${key}`);
  const { target, comment, edit, form } = value;
  ensure(
    form === undefined || (edit === undefined && target === undefined),
    'A form item cannot include an edit or target',
  );
  const kind =
    form !== undefined ? 'form' : edit !== undefined ? 'edit' : 'comment';
  const result: ReviewItem = { id, kind };
  if (comment !== undefined) {
    const note = text(comment, 'Comment', LIMITS.comment, true);
    if (note.trim()) result.comment = note;
  }
  if (edit !== undefined) {
    object(edit, 'Edit');
    ensure(target, 'An edit requires a target');
    result.edit = {
      before: text(edit.before, 'Edit before', LIMITS.text),
      after: text(edit.after, 'Edit after', LIMITS.text, true),
    };
  }
  if (form !== undefined) {
    object(form, 'Form');
    result.form = form;
  }
  if (target !== undefined) {
    object(target, 'Target');
    result.target = target;
  }
  ensure(
    (result.target && (result.comment || result.edit)) || result.form,
    'Each item needs a comment, edit, or form',
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
  const title = text(value.title, 'Form title', LIMITS.label);
  const { fields } = value;
  ensure(
    Array.isArray(fields) && fields.length <= LIMITS.labelFields,
    `Labels support at most ${LIMITS.labelFields} fields`,
  );
  return {
    title,
    fields: fields.map((field) => {
      object(field, 'Field label');
      return {
        label: text(field.label, 'Field label', LIMITS.label),
        value: text(field.value, 'Field value', LIMITS.label, true),
      };
    }),
  };
}
