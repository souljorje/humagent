import type { ServerResponse } from 'node:http';
import { Failure } from '@/shared/validate';

/** Answer a page request with an error. After the headers, only close it. */
export function fail(res: ServerResponse, error: unknown) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(error instanceof Failure ? error.status : 502, {
    'content-type': 'text/plain',
    'x-content-type-options': 'nosniff',
  });
  res.end(
    error instanceof Error ? error.message : 'The page could not be served',
  );
}
