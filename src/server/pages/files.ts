/** Read-only serving of an HTML file and the assets beside it. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Source } from '@/shared/feedback';
import { ensure, Failure } from '@/shared/validate';
import { noStore } from '@/server/assets';
import { DOCUMENT_LIMIT, type Decorate } from './documents';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
};
async function canonicalPath(file: string) {
  try {
    return await fs.realpath(file);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    throw new Failure(404, 'NOT_FOUND', 'File not found');
  }
}
export async function safeFile(root: string, requestPath: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    throw new Failure(400, 'INVALID_PATH', 'Invalid URL encoding');
  }
  ensure(
    !decoded.includes('\\') &&
      !decoded.includes('\0') &&
      !decoded.split('/').some((part) => part.startsWith('.')),
    'Hidden files and traversal are not shared',
    'FORBIDDEN',
    403,
  );
  const canonical = await canonicalPath(path.resolve(root, `.${decoded}`));
  const relative = path.relative(root, canonical);
  ensure(
    relative !== '' &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !relative.split(path.sep).some((part) => part.startsWith('.')),
    'Path escapes the shared directory',
    'FORBIDDEN',
    403,
  );
  ensure(
    MIME[path.extname(canonical).toLowerCase()],
    'This file type is not shared',
    'FORBIDDEN',
    403,
  );
  ensure((await fs.stat(canonical)).isFile(), 'Not a file', 'FORBIDDEN', 403);
  return canonical;
}
export async function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  source: Source,
  parentOrigin: string,
  decorate?: Decorate,
) {
  ensure(
    ['GET', 'HEAD'].includes(req.method ?? ''),
    'File pages are read-only',
    'READ_ONLY',
    405,
  );
  const route = req.url!;
  const rawPath = route.split('?')[0]!;
  const page = rawPath === '/' ? `/${path.basename(source.value)}` : '';
  const file = await safeFile(source.root!, page || rawPath);
  const bytes = await fs.readFile(file);
  ensure(
    bytes.length <= DOCUMENT_LIMIT,
    'Asset exceeds 8 MiB',
    'TOO_LARGE',
    413,
  );
  const html = /\.html?$/i.test(file);
  const net = source.network ? ' http: https: ws: wss:' : '';
  const policy = `default-src 'none'; script-src 'self' 'unsafe-inline'${net}; style-src 'self' 'unsafe-inline'${net}; img-src 'self' data: blob:${net}; font-src 'self' data:${net}; connect-src ${source.network ? "'self'" + net : "'none'"}; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors ${parentOrigin}`;
  res.writeHead(
    200,
    noStore(MIME[path.extname(file).toLowerCase()]!, {
      'content-security-policy': policy,
    }),
  );
  return res.end(
    req.method === 'HEAD'
      ? undefined
      : html && decorate
        ? decorate(bytes, page || route)
        : bytes,
  );
}
