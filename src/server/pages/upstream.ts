/** Documents of a local app, within the size limit. */
import http, { type IncomingMessage } from 'node:http';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { ensure } from '@/shared/validate';
import { DOCUMENT_LIMIT } from './documents';

export async function collect(stream: IncomingMessage) {
  const parts: Buffer[] = [];
  let count = 0;
  for await (const part of stream) {
    const buf = Buffer.from(part);
    count += buf.length;
    ensure(
      count <= DOCUMENT_LIMIT,
      'Upstream document exceeds 8 MiB',
      'TOO_LARGE',
      413,
    );
    parts.push(buf);
  }
  const bytes = Buffer.concat(parts);
  switch (stream.headers['content-encoding']) {
    case 'gzip':
      return gunzipSync(bytes, { maxOutputLength: DOCUMENT_LIMIT });
    case 'deflate':
      return inflateSync(bytes, { maxOutputLength: DOCUMENT_LIMIT });
    case 'br':
      return brotliDecompressSync(bytes, { maxOutputLength: DOCUMENT_LIMIT });
    default:
      return bytes;
  }
}
async function readDocument(response: IncomingMessage) {
  const { statusCode, headers } = response;
  try {
    ensure(
      statusCode === 200,
      `Local app returned ${statusCode}. Open its final route explicitly.`,
      'UPSTREAM',
      502,
    );
    ensure(
      headers['content-type']?.includes('text/html'),
      'Source did not return HTML',
      'UPSTREAM',
      502,
    );
    return await collect(response);
  } catch (error) {
    response.destroy();
    throw error;
  }
}
export async function fetchDocument(url: URL): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const request = http.get(url, {
    headers: { accept: 'text/html', 'accept-encoding': 'identity' },
    timeout: 15000,
  });
  request.on('response', (response) => resolve(readDocument(response)));
  request.on('timeout', () =>
    request.destroy(new Error('Local application timed out')),
  );
  request.on('error', reject);
  return promise;
}
