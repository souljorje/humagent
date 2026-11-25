/** Routes without a credential: the health check, the workspace page, and its browser code. */
import type { Hono } from 'hono';
import fs from 'node:fs';
import { ensure } from '@/shared/validate';
import { ASSET_PREFIX, asset, noStore, WORKSPACE } from '@/server/assets';
import { version } from '@/server/version';
import { json } from './http';

const POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const WORKSPACE_HEADERS = noStore('text/html; charset=utf-8', {
  'referrer-policy': 'no-referrer',
  'content-security-policy': POLICY,
});

async function assetResponse(pathname: string) {
  const { body, headers } = await asset(pathname);
  return new Response(body, { headers });
}

function workspaceResponse(method: string) {
  ensure(method === 'GET', 'Method not allowed', 'METHOD', 405);
  return new Response(fs.readFileSync(WORKSPACE), {
    headers: WORKSPACE_HEADERS,
  });
}

export function registerPublicRoutes(app: Hono) {
  app.all('/health', () =>
    json(200, { app: 'humagent', pid: process.pid, version }),
  );
  app.get(`${ASSET_PREFIX}*`, ({ req }) => assetResponse(req.path));
  app.all('/', ({ req }) => workspaceResponse(req.method));
}
