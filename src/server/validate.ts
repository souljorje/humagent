import { cloneJson, type Json } from '../shared/json.js';
import type { Review } from '../shared/feedback.js';
import { ensure, envelope, Failure, object, text } from '../shared/validate.js';

export { ensure, Failure, object, text };
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

/**
 * Check a review's envelope and give it an ID. The server stores `data` as it is.
 * The workspace applies the rules of the review's kind before it sends the review.
 */
export function review(value: unknown, id: string): Review {
  const { kind, comment, data, target } = envelope(value);
  ensure(
    comment || data !== undefined || target,
    'Each review needs a comment, data, or a target',
  );
  return {
    id,
    kind,
    ...(comment ? { comment } : {}),
    ...(data !== undefined ? { data: data as Json } : {}),
    ...(target ? { target } : {}),
  };
}
