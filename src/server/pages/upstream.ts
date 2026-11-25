/** Documents of a local app, within the size limit. */
import http, { type IncomingMessage } from 'node:http';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { ensure } from '../../shared/validate.js';
import { DOCUMENT_LIMIT } from './documents.js';

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
export async function fetchDocument(url: URL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      {
        headers: { accept: 'text/html', 'accept-encoding': 'identity' },
        timeout: 15000,
      },
      async (res) => {
        try {
          ensure(
            res.statusCode === 200,
            `Local app returned ${res.statusCode}. Open its final route explicitly.`,
            'UPSTREAM',
            502,
          );
          ensure(
            res.headers['content-type']?.includes('text/html'),
            'Source did not return HTML',
            'UPSTREAM',
            502,
          );
          resolve(await collect(res));
        } catch (e) {
          res.destroy();
          reject(e);
        }
      },
    );
    req.on('timeout', () =>
      req.destroy(new Error('Local application timed out')),
    );
    req.on('error', reject);
  });
}
