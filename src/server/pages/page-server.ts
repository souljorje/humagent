/** The server of one session's page, on an origin of its own. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensure } from '../../shared/validate.js';
import { SDK_ASSET, browserAsset } from '../assets.js';
import type { Store } from '../sessions/store.js';
import { digest, inject } from './documents.js';
import { fail } from './failure.js';
import { safeFile, serveFile } from './files.js';
import { proxyApplication, upgradeApplication } from './proxy.js';

export interface PageServer {
  origin: string;
  frameUrl: string;
  channel: string;
  activate: (documentId: unknown) => void;
  checkRevision: () => Promise<string>;
  close: () => Promise<void>;
}
export async function startPageServer(
  store: Store,
  id: string,
  parentOrigin: string,
): Promise<PageServer> {
  const { source, pagePath } = store.get(id);
  const channel = randomBytes(24).toString('hex');
  let origin = '';
  const upstreamUrl = source.kind === 'url' ? new URL(source.value) : undefined;
  let currentPath =
    pagePath ??
    (upstreamUrl
      ? upstreamUrl.pathname + upstreamUrl.search
      : `/${encodeURIComponent(path.basename(source.value))}`);
  const upstreamOrigin = upstreamUrl?.origin ?? '';
  const documents = new Map<string, { route: string; revision: string }>();
  let activeDocument: string | undefined;
  async function revision() {
    if (source.kind === 'url') return store.get(id).revision;
    const bytes = await fs.readFile(
      await safeFile(source.root!, currentPath.split('?')[0]!),
    );
    const hash = digest(bytes);
    store.setRevision(id, hash);
    return hash;
  }
  function decorated(bytes: Buffer, route: string) {
    const hash = digest(bytes);
    const documentId = randomBytes(16).toString('hex');
    documents.set(documentId, { route, revision: hash });
    if (documents.size > 256) documents.delete(documents.keys().next().value!);
    return inject(bytes.toString('utf8'), {
      session: id,
      channel,
      parentOrigin,
      revision: hash,
      documentId,
      sourceUrl:
        source.kind === 'file'
          ? path.resolve(
              source.root!,
              '.' + decodeURIComponent(route.split('?')[0]!),
            )
          : new URL(route, upstreamOrigin).href,
    });
  }
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer(async (req, res) => {
    try {
      ensure(
        req.headers.host === new URL(origin).host,
        'Invalid page host',
        'FORBIDDEN',
        403,
      );
      ensure(
        typeof req.url === 'string' &&
          req.url.startsWith('/') &&
          !req.url.startsWith('//'),
        'Invalid request path',
      );
      const rawPath = req.url.split('?')[0]!;
      const url = new URL(req.url, origin);
      // Fetches and HTML fragments must not replace the attached document.
      const documentRequest =
        req.method !== 'HEAD' &&
        ['document', 'iframe', 'frame'].includes(
          String(req.headers['sec-fetch-dest'] ?? ''),
        );
      const requestOrigin = req.headers.origin;
      if (requestOrigin && !['GET', 'HEAD'].includes(req.method ?? 'GET'))
        ensure(requestOrigin === origin, 'Foreign origin', 'FORBIDDEN', 403);
      if (rawPath.startsWith('/__humagent/')) {
        const asset = await browserAsset(
          rawPath.slice('/__humagent'.length),
          SDK_ASSET,
        );
        res.writeHead(200, asset.headers);
        return res.end(asset.body);
      }
      const decorate = documentRequest ? decorated : undefined;
      if (source.kind === 'file') {
        await serveFile(req, res, source, parentOrigin, decorate);
        return;
      }
      proxyApplication(
        req,
        res,
        url.pathname + url.search,
        origin,
        upstreamOrigin,
        decorate,
      );
    } catch (error) {
      fail(res, error);
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) =>
    upgradeApplication(req, socket, head, origin, upstreamOrigin),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const watcher =
    source.kind === 'file'
      ? setInterval(() => {
          void revision().catch(() => {});
        }, 2000)
      : undefined;
  watcher?.unref();
  return {
    origin,
    channel,
    activate(documentId) {
      ensure(typeof documentId === 'string', 'Missing document identity');
      if (documentId === activeDocument) return;
      const document = documents.get(documentId);
      ensure(
        document,
        'Document expired. Refresh the page.',
        'STALE_DOCUMENT',
        409,
      );
      currentPath = document.route;
      store.setRevision(id, document.revision, currentPath);
      activeDocument = documentId;
    },
    get frameUrl() {
      return origin + currentPath;
    },
    checkRevision: revision,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(watcher);
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
