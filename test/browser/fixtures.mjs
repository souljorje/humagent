import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../../dist/runtime/server.js';
import { fixture } from '../fixtures.mjs';

export const test = base.extend({
  workspace: async ({ request }, use) => {
    const directory = fixture('browser');
    const state = path.join(directory, 'state');
    let runtime;
    try {
      fs.cpSync(
        fileURLToPath(new URL('../../examples/', import.meta.url)),
        path.join(directory, 'examples'),
        { recursive: true },
      );
      runtime = await createRuntime({ directory: state });
      await use({
        file: (name = 'plan.html') => path.join(directory, 'examples', name),
        get origin() {
          return runtime.origin;
        },
        get store() {
          return runtime.store;
        },
        async restart() {
          await runtime.close();
          runtime = await createRuntime({ directory: state });
        },
        async api(route, method = 'GET', data) {
          const response = await request.fetch(runtime.origin + route, {
            method,
            headers: {
              authorization: `Bearer ${runtime.token}`,
              'content-type': 'application/json',
            },
            data,
          });
          const body = await response.text();
          expect(
            response.ok(),
            `${method} ${route}: ${response.status()} ${body}`,
          ).toBeTruthy();
          return JSON.parse(body);
        },
      });
    } finally {
      try {
        await runtime?.close();
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  },

  review: async ({ page, workspace }, use) => {
    const evaluate = (fn, argument) => {
      const frame = page
        .frames()
        .find((frame) => frame.parentFrame() === page.mainFrame());
      expect(frame, 'Attached surface frame').toBeDefined();
      return frame.evaluate(fn, argument);
    };
    const ready = async () => {
      await expect(page.locator('#bridge-status')).toHaveText(
        'Interface connected',
      );
      await expect.poll(() => evaluate(() => !!window.humagent)).toBe(true);
    };
    await use({
      frame: page.frameLocator('#frame'),
      evaluate,
      ready,
      async addComment(selector, comment) {
        await page
          .frameLocator('#frame')
          .locator(selector)
          .click({ button: 'right' });
        await page
          .frameLocator('#frame')
          .getByRole('button', { name: 'Comment', exact: true })
          .click();
        await page
          .frameLocator('#frame')
          .getByLabel('Comment', { exact: true })
          .fill(comment);
        await page
          .frameLocator('#frame')
          .getByRole('button', { name: 'Add to review', exact: true })
          .click();
        await expect(
          page
            .frameLocator('#frame')
            .getByRole('dialog', { name: 'Add feedback' }),
        ).toBeHidden();
      },
      async replace(selector, replacement) {
        await evaluate((selector) => {
          const element = document.querySelector(selector),
            range = document.createRange();
          range.selectNodeContents(element);
          const selection = document.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        }, selector);
        await page
          .frameLocator('#frame')
          .getByRole('button', { name: 'Suggest replacement', exact: true })
          .click();
        await page
          .frameLocator('#frame')
          .getByLabel('Exact replacement', { exact: true })
          .fill(replacement);
        await page
          .frameLocator('#frame')
          .getByRole('button', { name: 'Add to review', exact: true })
          .click();
        await expect(
          page
            .frameLocator('#frame')
            .getByRole('dialog', { name: 'Add feedback' }),
        ).toBeHidden();
      },
      async state() {
        return page.evaluate(() =>
          JSON.parse(
            localStorage.getItem(
              `humagent:review:${new URL(location.href).searchParams.get('session')}`,
            ),
          ),
        );
      },
      async open(target = workspace.file()) {
        const opened = await workspace.api('/api/open', 'POST', { target });
        await page.goto(opened.url);
        await ready();
        return opened;
      },
    });
  },

  plan: async ({ review }, use) => {
    await use(await review.open());
  },

  app: async ({ workspace }, use) => {
    let dynamicRequests = 0;
    const server = http.createServer((req, res) => {
      if (req.url === '/api/value') {
        res.setHeader('content-type', 'application/json');
        res.end('{"value":42}');
        return;
      }
      res.setHeader('content-type', 'text/html');
      if (req.url === '/fragment') {
        res.setHeader('content-encoding', 'gzip');
        res.end(gzipSync('<p>Unchanged HTML fragment</p>'));
      } else if (req.url === '/dynamic') {
        dynamicRequests++;
        res.end(
          `<h1>Dynamic ${dynamicRequests}</h1><form id="dynamic" data-humagent-intent="review"><input name="choice" value="keep"><button type="submit">Send</button></form>`,
        );
      } else if (['/a', '/b', '/c'].includes(req.url)) {
        res.end(
          `<h1>Page ${req.url.slice(1)}</h1><a href="/b">Next page</a><form id="route" data-humagent-intent="review" data-humagent-persist><input name="note"></form>`,
        );
      } else {
        const name =
          req.url === '/example.css' ? 'example.css' : 'existing.html';
        res.setHeader(
          'content-type',
          name.endsWith('.css') ? 'text/css' : 'text/html',
        );
        res.end(fs.readFileSync(workspace.file(name)));
      }
    });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      await use({
        origin: `http://127.0.0.1:${server.address().port}`,
        get dynamicRequests() {
          return dynamicRequests;
        },
      });
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
    }
  },

  pageErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use();
      expect.soft(errors, 'Unhandled browser errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
