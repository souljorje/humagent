import {
  test as base,
  expect,
  type Frame,
  type FrameLocator,
  type Locator,
} from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../../dist/runtime/server.js';
import { fixture } from '../fixtures.ts';
import type { AddressInfo } from 'node:net';
import type { Session } from '../../dist/runtime/store.js';
import type { WorkspaceView } from '../../src/shared/feedback.js';
import type { ObjectValue } from '../../src/shared/json.js';

type Runtime = Awaited<ReturnType<typeof createRuntime>>;
type Feedback = Extract<
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
  /** Values of the draft that a form owns, by form key. */
  form(sessionId: string, key: string): ObjectValue | undefined;
  restart(): Promise<void>;
  /** `timeout` drops the request after that many milliseconds. Zero never drops it. */
  api<T = WorkspaceView>(
    route: string,
    method?: string,
    data?: unknown,
    timeout?: number,
  ): Promise<T>;
}
interface Review {
  frame: FrameLocator;
  /** The "Edit text" box of the open feedback popover. */
  editor: Locator;
  /** The "Comment" field of the open feedback popover. */
  note: Locator;
  evaluate: Frame['evaluate'];
  ready(): Promise<void>;
  expand(open?: boolean): Promise<void>;
  /** Start an agent wait. `stopAfterMs` drops it, like an agent that stops. */
  connect(stopAfterMs?: number): Promise<void>;
  receive(): Promise<Feedback>;
  /** Receive the next feedback and acknowledge its receipt. */
  deliver(): Promise<Feedback>;
  /** Turn commenting on. */
  annotate(): Promise<void>;
  /** Select the first text node of an element, from `start` to `end`, and release the mouse. */
  selectText(selector: string, start?: number, end?: number): Promise<void>;
  addComment(selector: string, comment: string): Promise<void>;
  replace(selector: string, replacement: string): Promise<void>;
  /** The server's saved feedback for the open session. */
  state(): Promise<Session>;
  /** The item of the saved draft at `index`. */
  draft(index?: number): Promise<Session['drafts'][number]['item']>;
  /** Wait until the open session holds `count` events, then return them. */
  events(count: number): Promise<Session['events']>;
  /** Let the server handle the next request to a session route, then drop its response. */
  loseResponse(route: string): Promise<void>;
  open(target?: string): Promise<Opened>;
}
interface Fixtures {
  workspace: Workspace;
  review: Review;
  plan: Opened;
  app: { origin: string; dynamicRequests: number };
  pageErrors: void;
}
const fixtureDirectory = new URL('../fixtures/', import.meta.url);
const existingModule = transpileModule(
  fs.readFileSync(new URL('existing.ts', fixtureDirectory), 'utf8'),
  {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  },
).outputText;

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
      fs.cpSync(
        fileURLToPath(fixtureDirectory),
        path.join(directory, 'examples'),
        {
          recursive: true,
          filter: (source) => !source.endsWith('.ts'),
        },
      );
      fs.writeFileSync(
        path.join(directory, 'examples/existing.js'),
        existingModule,
      );
      runtime = await createRuntime({ directory: state });
      await use({
        file: (name = 'review.html') => path.join(directory, 'examples', name),
        get origin() {
          return runtime.origin;
        },
        get store() {
          return runtime.store;
        },
        form(sessionId, key) {
          return runtime.store.get(sessionId).drafts.find((d) => d.key === key)
            ?.item.values;
        },
        async restart() {
          await runtime.close();
          runtime = await createRuntime({ directory: state });
        },
        async api<T = WorkspaceView>(
          route: string,
          method = 'GET',
          data?: unknown,
          timeout?: number,
        ): Promise<T> {
          const response = await request.fetch(runtime.origin + route, {
            method,
            timeout,
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
    const receipts: Promise<Feedback | { status: string }>[] = [];
    const frame = page.frameLocator('#frame');
    const editor = frame.getByRole('textbox', {
      name: 'Edit text',
      exact: true,
    });
    const note = frame.getByLabel('Comment', { exact: true });
    const annotateButton = page.locator('#annotate');
    const session = () => new URL(page.url()).searchParams.get('session')!;
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
      await attachedFrame().waitForFunction(() => !!window.humagent);
    };
    const receive = async () => {
      const received = receipts.length
        ? await receipts.shift()!
        : workspace.store.take(session());
      if (received?.status !== 'feedback' || !('receipt' in received))
        throw new Error('Expected agent feedback');
      return received as Feedback;
    };
    const annotate = async () => {
      if ((await annotateButton.getAttribute('aria-pressed')) !== 'true')
        await annotateButton.click();
      await expect(annotateButton).toHaveAttribute('aria-pressed', 'true');
    };
    const selectText = (selector: string, start?: number, end?: number) =>
      attachedFrame().evaluate(
        ({ selector, start, end }) => {
          const element = document.querySelector(selector)!,
            node = element.firstChild!,
            range = document.createRange();
          range.setStart(node, start ?? 0);
          range.setEnd(node, end ?? node.textContent!.length);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(range);
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        },
        { selector, start, end },
      );
    const confirm = async (name: RegExp) => {
      await frame.getByRole('button', { name }).click();
      await expect(
        frame.getByRole('dialog', { name: 'Feedback' }),
      ).toBeHidden();
    };
    const state = async () => workspace.store.get(session());
    await use({
      frame,
      editor,
      note,
      get evaluate() {
        const frame = attachedFrame();
        return frame.evaluate.bind(frame);
      },
      ready,
      async connect(stopAfterMs) {
        const id = session();
        const view = await workspace.api(`/api/sessions/${id}`);
        if (view.agent === 'idle') {
          const wait = workspace.api<Feedback | { status: string }>(
            `/api/sessions/${id}/wait`,
            'POST',
            {},
            stopAfterMs ?? 0,
          );
          receipts.push(
            stopAfterMs ? wait.catch(() => ({ status: 'stopped' })) : wait,
          );
        }
        await expect(page.locator('#agent-state')).toHaveText(
          /Agent (listening|working)/,
        );
      },
      receive,
      async deliver() {
        const received = await receive();
        workspace.store.acknowledge(session(), received.receipt);
        return received;
      },
      async expand(open = true) {
        const toggle = page.locator('#toggle-review');
        if ((await toggle.getAttribute('aria-expanded')) !== String(open))
          await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', String(open));
      },
      annotate,
      selectText,
      async addComment(selector, comment) {
        await annotate();
        await frame.locator(selector).click();
        await note.fill(comment);
        await confirm(/^(Add comment|Confirm text edit)$/);
      },
      async replace(selector, replacement) {
        await annotate();
        await selectText(selector);
        await editor.fill(replacement);
        await confirm(/^(Confirm text edit|Save)$/);
      },
      state,
      async draft(index = 0) {
        return (await state()).drafts[index]!.item;
      },
      async events(count) {
        await expect
          .poll(() => workspace.store.get(session()).events.length)
          .toBe(count);
        return workspace.store.get(session()).events;
      },
      async loseResponse(route) {
        let lost = false;
        await page.route(
          `**/api/sessions/${session()}/${route}`,
          async (request) => {
            if (lost) return request.continue();
            lost = true;
            await request.fetch();
            await request.abort();
          },
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
      } else if (['/a', '/b'].includes(req.url || '')) {
        res.end(
          `<h1>Page ${req.url!.slice(1)}</h1><a href="/b">Next page</a><form id="route" data-humagent-intent="review"><input name="note"></form>`,
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
