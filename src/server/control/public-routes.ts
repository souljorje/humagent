/** Routes without a credential: the health check, the workspace page, and its browser modules. */
import type { Hono } from 'hono';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensure } from '../../shared/validate.js';
import { UI_ASSET, UI_DIRECTORIES, browserAsset, noStore } from '../assets.js';
import { version } from '../version.js';
import { json } from './http.js';

const PAGE = fileURLToPath(new URL('../../ui/index.html', import.meta.url));

export function registerPublicRoutes(app: Hono) {
  app.all('/health', () =>
    json(200, { app: 'humagent', pid: process.pid, version }),
  );
  for (const directory of UI_DIRECTORIES)
    app.get(`/${directory}/*`, async (c) => {
      const { body, headers } = await browserAsset(c.req.path, UI_ASSET);
      return new Response(body, { headers });
    });
  app.all('/', (c) => {
    ensure(c.req.method === 'GET', 'Method not allowed', 'METHOD', 405);
    return new Response(fs.readFileSync(PAGE), {
      headers: noStore('text/html; charset=utf-8', {
        'referrer-policy': 'no-referrer',
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      }),
    });
  });
}
