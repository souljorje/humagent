/** The server of one session's page, on an origin of its own. */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import path from 'node:path';
import type { Source } from '@/shared/feedback';
import { ensure } from '@/shared/validate';
import { ASSET_PREFIX, asset } from '@/server/assets';
import type { Store } from '@/server/sessions/store';
import { digest, inject, type Decorate, type Sdk } from './documents';
import { fail } from './failure';
import { safeFile, serveFile } from './files';
import { proxyApplication, upgradeApplication } from './proxy';

const MAX_DOCUMENTS = 256;
const REVISION_INTERVAL = 2000;
const DOCUMENT_DESTINATIONS = ['document', 'iframe', 'frame'];
const READ_METHODS = ['GET', 'HEAD'];

/** The URLs of the browser code. */
export interface Client {
  workspace: string;
  sdk: Sdk;
}
export interface PageServer {
  readonly origin: string;
  readonly frameUrl: string;
  readonly channel: string;
  activate(documentId: unknown): void;
  checkRevision(): Promise<string>;
  close(): Promise<void>;
}
interface PageDocument {
  readonly route: string;
  readonly revision: string;
}
interface Page {
  readonly store: Store;
  readonly id: string;
  readonly source: Source;
  readonly sdk: Sdk;
  readonly channel: string;
  readonly parentOrigin: string;
  /** The origin of a local app. A file page has none. */
  readonly upstreamOrigin: string;
  /** The served documents that the workspace can attach. */
  readonly documents: Map<string, PageDocument>;
  readonly sockets: Set<Socket>;
  /** The page origin, after the server listens. */
  origin: string;
  currentPath: string;
  activeDocument?: string;
}

const pathOf = (route: string) => route.split('?')[0]!;

function createPage(store: Store, id: string, client: Client): Page {
  const { source, pagePath } = store.get(id);
  const { kind, value } = source;
  const upstream = kind === 'url' ? new URL(value) : undefined;
  return {
    store,
    id,
    source,
    sdk: client.sdk,
    channel: randomBytes(24).toString('hex'),
    parentOrigin: new URL(client.workspace).origin,
    upstreamOrigin: upstream?.origin ?? '',
    documents: new Map(),
    sockets: new Set(),
    origin: '',
    currentPath:
      pagePath ??
      (upstream
        ? upstream.pathname + upstream.search
        : `/${encodeURIComponent(path.basename(value))}`),
  };
}

/** An HTTP revision follows the attached document. */
async function checkRevision({ store, id, source, currentPath }: Page) {
  if (source.kind === 'url') return store.get(id).revision;
  const file = await safeFile(source.root!, pathOf(currentPath));
  const revision = digest(await fs.readFile(file));
  store.setRevision(id, revision);
  return revision;
}

/** Attach the SDK to a document, and remember it. The oldest document expires. */
function decorate(page: Page, bytes: Buffer, route: string) {
  const { documents, source } = page;
  const revision = digest(bytes);
  const documentId = randomBytes(16).toString('hex');
  documents.set(documentId, { route, revision });
  if (documents.size > MAX_DOCUMENTS)
    documents.delete(documents.keys().next().value!);
  const bootstrap = {
    session: page.id,
    channel: page.channel,
    parentOrigin: page.parentOrigin,
    revision,
    documentId,
    sourceUrl:
      source.kind === 'file'
        ? path.resolve(source.root!, '.' + decodeURIComponent(pathOf(route)))
        : new URL(route, page.upstreamOrigin).href,
  };
  return inject(bytes.toString('utf8'), bootstrap, page.sdk);
}

async function serveSource(
  page: Page,
  req: IncomingMessage,
  res: ServerResponse,
  route: string,
) {
  const { origin, parentOrigin, source, upstreamOrigin } = page;
  // Fetches and HTML fragments must not replace the attached document.
  const isDocument =
    req.method !== 'HEAD' &&
    DOCUMENT_DESTINATIONS.includes(String(req.headers['sec-fetch-dest'] ?? ''));
  const decorator: Decorate | undefined = isDocument
    ? (bytes, path) => decorate(page, bytes, path)
    : undefined;
  if (source.kind === 'file')
    return serveFile(req, res, source, parentOrigin, decorator);
  const { pathname, search } = new URL(route, origin);
  proxyApplication({
    req,
    res,
    route: pathname + search,
    origin,
    upstreamOrigin,
    decorate: decorator,
  });
}

async function serve(page: Page, req: IncomingMessage, res: ServerResponse) {
  const { headers, method = 'GET', url: route } = req;
  const { host } = new URL(page.origin);
  ensure(headers.host === host, 'Invalid page host', 'FORBIDDEN', 403);
  ensure(
    typeof route === 'string' &&
      route.startsWith('/') &&
      !route.startsWith('//'),
    'Invalid request path',
  );
  if (headers.origin && !READ_METHODS.includes(method))
    ensure(headers.origin === page.origin, 'Foreign origin', 'FORBIDDEN', 403);
  if (!pathOf(route).startsWith(ASSET_PREFIX))
    return serveSource(page, req, res, route);
  const { body, headers: assetHeaders } = await asset(pathOf(route));
  res.writeHead(200, assetHeaders);
  res.end(body);
}

async function handle(page: Page, req: IncomingMessage, res: ServerResponse) {
  try {
    await serve(page, req, res);
  } catch (error) {
    fail(res, error);
  }
}

function trackSocket({ sockets }: Page, socket: Socket) {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
}

async function listen(server: http.Server) {
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', resolve);
  await promise;
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Follow changes of a file page. */
function watch(page: Page) {
  if (page.source.kind !== 'file') return undefined;
  const watcher = setInterval(
    () => void checkRevision(page).catch(() => {}),
    REVISION_INTERVAL,
  );
  return watcher.unref();
}

/** The workspace attached a served document. */
function activate(page: Page, documentId: unknown) {
  ensure(typeof documentId === 'string', 'Missing document identity');
  if (documentId === page.activeDocument) return;
  const document = page.documents.get(documentId);
  ensure(
    document,
    'Document expired. Refresh the page.',
    'STALE_DOCUMENT',
    409,
  );
  page.currentPath = document.route;
  page.store.setRevision(page.id, document.revision, page.currentPath);
  page.activeDocument = documentId;
}

async function close(
  { sockets }: Page,
  server: http.Server,
  watcher: ReturnType<typeof watch>,
) {
  const { promise, resolve } = Promise.withResolvers<void>();
  clearInterval(watcher);
  for (const socket of sockets) socket.destroy();
  server.closeAllConnections();
  server.close(() => resolve());
  await promise;
}

export async function startPageServer(
  store: Store,
  id: string,
  client: Client,
): Promise<PageServer> {
  const page = createPage(store, id, client);
  const server = http.createServer((req, res) => void handle(page, req, res));
  server.on('connection', (socket) => trackSocket(page, socket));
  server.on('upgrade', (req, socket, head) =>
    upgradeApplication(req, socket, head, page.origin, page.upstreamOrigin),
  );
  page.origin = await listen(server);
  const watcher = watch(page);
  return {
    origin: page.origin,
    channel: page.channel,
    get frameUrl() {
      return page.origin + page.currentPath;
    },
    activate: (documentId) => activate(page, documentId),
    checkRevision: () => checkRevision(page),
    close: () => close(page, server, watcher),
  };
}
