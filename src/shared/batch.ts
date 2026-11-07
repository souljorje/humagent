import { cloneJson, type ObjectValue } from './json.js';

export type ReviewTarget = ObjectValue & { revision?: string };
export interface ReviewItem {
  id: string;
  target?: ReviewTarget;
  comment?: string;
  replacement?: { before: string; after: string };
  intent?: string;
  values?: ObjectValue;
}
export type DraftItem = Omit<ReviewItem, 'id'>;
export interface Input {
  protocol: 2;
  clientId: string;
  revision: string;
  payload: { message?: string; items: ReviewItem[] };
}

export const PROTOCOL = 2;
export const MAX_BYTES = 256 * 1024;
export const MAX_ITEMS = 100;

export class ReviewError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'INVALID_INPUT', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
function require(value: unknown, message: string): asserts value {
  if (!value) throw new ReviewError(message);
}
function object(value: unknown): asserts value is ObjectValue {
  require(value &&
    typeof value === 'object' &&
    !Array.isArray(value), 'Expected an object');
}
function text(
  value: unknown,
  name: string,
  limit = 4000,
  empty = false,
): asserts value is string {
  require(typeof value === 'string' &&
    (empty || value.trim().length > 0) &&
    value.length <= limit, `Invalid ${name}`);
}

/** Validate one immutable batch. The wire protocol is independent of the storage format. */
export function batch(raw: unknown): Input {
  const original = cloneJson(raw);
  object(original);
  if (new TextEncoder().encode(JSON.stringify(original)).length > MAX_BYTES)
    throw new ReviewError('Payload exceeds 256 KiB', 'TOO_LARGE', 413);
  text(original.clientId, 'clientId', 100);
  text(original.revision, 'revision', 128);
  const value = original;
  if (value.protocol !== PROTOCOL)
    throw new ReviewError(
      'Reload the workspace to use review batches. Pending input is retained.',
      'PROTOCOL_MISMATCH',
    );
  require(value.kind === undefined, 'Batch events do not have a kind');
  object(value.payload);
  const p = value.payload;
  require(Array.isArray(p.items) &&
    p.items.length <= MAX_ITEMS, 'A batch supports at most 100 items');
  if (p.message !== undefined)
    text(p.message, 'overall instruction', 4000, true);
  require(p.items.length ||
    p.message?.trim(), 'Add feedback or an overall instruction');
  const ids = new Set();
  for (const item of p.items) {
    object(item);
    text(item.id, 'item ID', 150);
    require(!ids.has(item.id), 'Item IDs must be unique');
    ids.add(item.id);
    require(item.kind === undefined &&
      item.type === undefined, 'Feedback uses fields, not item types');
    if (item.target !== undefined) {
      object(item.target);
      if (item.target.revision !== undefined)
        require(item.target.revision ===
          value.revision, 'Target revision does not match the batch');
    }
    if (item.comment !== undefined) text(item.comment, 'comment', 4000, true);
    if (item.replacement !== undefined) {
      object(item.replacement);
      require(!!item.target, 'A replacement requires a target');
      text(item.replacement.before, 'original text', 50000);
      text(item.replacement.after, 'replacement', 50000, true);
    }
    if (item.intent !== undefined || item.values !== undefined) {
      text(item.intent, 'intent', 200);
      object(item.values);
    }
    require((item.target && (item.comment?.trim() || item.replacement)) ||
      (item.intent &&
        item.values), 'Each item needs a comment, replacement, or structured decision');
  }
  return {
    protocol: PROTOCOL,
    clientId: original.clientId,
    revision: original.revision,
    payload: p as unknown as Input['payload'],
  };
}

/** Object key order does not change request identity. Array order still matters. */
export function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${fingerprint((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
