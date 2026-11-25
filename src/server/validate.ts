import { cloneJson } from '@/shared/json';
import type { NewReview } from '@/shared/feedback';
import { ensure, Failure } from '@/shared/validate';

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

export function ensureReviewContent({ comment, data, target }: NewReview) {
  ensure(
    comment || data !== undefined || target,
    'Each review needs a comment, data, or a target',
  );
}
