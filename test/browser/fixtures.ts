import {
  test as base,
  expect,
  type Frame,
  type FrameLocator,
} from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../../dist/runtime/server.js';
import { fixture } from '../fixtures.ts';
import type { AddressInfo } from 'node:net';
import type { SessionSnapshot } from '../../dist/runtime/server.js';
import type { ReviewState, FormState } from '../../src/shared/review.js';
import type { ObjectValue } from '../../src/shared/json.js';

type Runtime = Awaited<ReturnType<typeof createRuntime>>;
export type Feedback = Extract<
  NonNullable<ReturnType<Runtime['store']['take']>>,
  { status: 'feedback' }
>;
interface Opened {
  session: string;
  url: string;
}
interface Workspace {
  file(name?: string): string;
  origin: string;
  store: Runtime['store'];
  forms(sessionId: string): Record<string, ObjectValue>;
  restart(): Promise<void>;
  api<T = SessionSnapshot>(
    route: string,
    method?: string,
    data?: unknown,
  ): Promise<T>;
}
interface Review {
  frame: FrameLocator;
  evaluate: Frame['evaluate'];
  ready(): Promise<void>;
  addComment(selector: string, comment: string): Promise<void>;
  replace(selector: string, replacement: string): Promise<void>;
  state(): Promise<ReviewState>;
  open(target?: string): Promise<Opened>;
}
interface Fixtures {
  workspace: Workspace;
  review: Review;
  plan: Opened;
  app: { origin: string; dynamicRequests: number };
  pageErrors: void;
}

export const test = base.extend<Fixtures>({
  workspace: async ({ request }, use) => {
    const directory = fixture('browser');
    const state = path.join(directory, 'state');
    let runtime!: Runtime;
    try {
      fs.cpSync(
        fileURLToPath(new URL('../../dist/examples/', import.meta.url)),
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
        forms(sessionId) {
          return (runtime.store.get(sessionId).state as FormState).forms || {};
        },
        async restart() {
          await runtime.close();
          runtime = await createRuntime({ directory: state });
        },
        async api<T = SessionSnapshot>(
          route: string,
          method = 'GET',
          data?: unknown,
        ): Promise<T> {
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
    const attachedFrame = () => {
      const frame = page
        .frames()
        .find((frame) => frame.parentFrame() === page.mainFrame());
      expect(frame, 'Attached surface frame').toBeDefined();
      return frame!;
    };
    const ready = async () => {
      await expect(page.locator('#bridge-status')).toHaveText(
        'Interface connected',
      );
      await expect
        .poll(() => attachedFrame().evaluate(() => !!window.humagent))
        .toBe(true);
    };
    await use({
      frame: page.frameLocator('#frame'),
      get evaluate() {
        const frame = attachedFrame();
        return frame.evaluate.bind(frame);
      },
      ready,
      async addComment(selector, comment) {
        if (
          (await page.locator('#annotate').getAttribute('aria-pressed')) !==
          'true'
        )
          await page.locator('#annotate').click();
        await page.frameLocator('#frame').locator(selector).click();
        await page
          .frameLocator('#frame')
          .getByLabel('Comment', { exact: true })
          .fill(comment);
        await page
          .frameLocator('#frame')
          .getByRole('button', { name: 'Add comment', exact: true })
          .click();
        await expect(
          page.frameLocator('#frame').getByRole('dialog', { name: 'Feedback' }),
        ).toBeHidden();
      },
      async replace(selector, replacement) {
        if (
          (await page.locator('#annotate').getAttribute('aria-pressed')) !==
          'true'
        )
          await page.locator('#annotate').click();
        await expect(page.locator('#annotate')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await attachedFrame().evaluate((selector) => {
          const element = document.querySelector(selector)!,
            range = document.createRange();
          range.selectNodeContents(element.firstChild!);
          const selection = document.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        }, selector);
        await page
          .frameLocator('#frame')
          .getByRole('textbox', { name: 'Edit text', exact: true })
          .fill(replacement);
        await page
          .frameLocator('#frame')
          .getByRole('button', { name: /^(Confirm text edit|Save)$/ })
          .click();
        await expect(
          page.frameLocator('#frame').getByRole('dialog', { name: 'Feedback' }),
        ).toBeHidden();
      },
      async state() {
        return page.evaluate(() =>
          JSON.parse(
            localStorage.getItem(
              `humagent:review:${new URL(location.href).searchParams.get('session')}`,
            )!,
          ),
        );
      },
      async open(target = workspace.file()) {
        const opened = await workspace.api<Opened>('/api/open', 'POST', {
          target,
        });
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
      } else if (['/a', '/b', '/c'].includes(req.url || '')) {
        res.end(
          `<h1>Page ${req.url!.slice(1)}</h1><a href="/b">Next page</a><form id="route" data-humagent-intent="review" data-humagent-persist><input name="note"></form>`,
        );
      } else {
        const name =
          req.url === '/example.css'
            ? 'example.css'
            : req.url === '/existing.js'
              ? 'existing.js'
              : 'existing.html';
        res.setHeader(
          'content-type',
          name.endsWith('.css')
            ? 'text/css'
            : name.endsWith('.js')
              ? 'text/javascript'
              : 'text/html',
        );
        res.end(fs.readFileSync(workspace.file(name)));
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      await use({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
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
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use();
      expect.soft(errors, 'Unhandled browser errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
