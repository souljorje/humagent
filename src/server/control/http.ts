/** JSON requests and replies of the control routes. */
import { LIMITS } from '../../shared/feedback.js';
import { ensure, Failure, object } from '../../shared/validate.js';
import { noStore } from '../assets.js';
import { parseJson } from '../validate.js';

export const JSON_HEADERS = noStore('application/json');
export const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
/** The JSON object of a request, within the byte limit. */
export async function body(req: Request) {
  ensure(
    req.headers.get('content-type')?.startsWith('application/json'),
    'Expected application/json',
    'CONTENT_TYPE',
    415,
  );
  let total = 0;
  const parts: Uint8Array[] = [];
  const reader = req.body?.getReader();
  for (let chunk = await reader?.read(); chunk && !chunk.done;) {
    total += chunk.value.byteLength;
    ensure(total <= LIMITS.bodyBytes, 'Body exceeds 256 KiB', 'TOO_LARGE', 413);
    parts.push(chunk.value);
    chunk = await reader!.read();
  }
  const value = parseJson(Buffer.concat(parts).toString('utf8'));
  object(value);
  return value;
}
export function failure(error: unknown) {
  return {
    error: error instanceof Failure ? error.code : 'ERROR',
    message: error instanceof Error ? error.message : 'Request failed',
  };
}
export function fail(error: unknown) {
  return json(error instanceof Failure ? error.status : 400, failure(error));
}
