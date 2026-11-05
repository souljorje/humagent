import { cloneJson } from './json.js';

export const PROTOCOL = 2;
export const MAX_BYTES = 256 * 1024;
export const MAX_ITEMS = 100;

export class ReviewError extends Error {
  constructor(message, code = 'INVALID_INPUT', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
function require(value, message) {
  if (!value) throw new ReviewError(message);
}
function object(value) {
  require(value &&
    typeof value === 'object' &&
    !Array.isArray(value), 'Expected an object');
}
function text(value, name, limit = 4000, empty = false) {
  require(typeof value === 'string' &&
    (empty || value.trim().length > 0) &&
    value.length <= limit, `Invalid ${name}`);
}

/** Validate one immutable batch. The wire protocol is independent of the storage format. */
export function batch(raw) {
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
    clientId: value.clientId,
    revision: value.revision,
    payload: p,
  };
}

/** Object key order does not change request identity. Array order still matters. */
export function fingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${fingerprint(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
