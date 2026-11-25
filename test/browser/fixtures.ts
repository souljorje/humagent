import { test as base, expect, type Frame, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'humagent';
import type { Delivered } from 'humagent/feedback';
import { fixture } from '../fixtures';

/** One server, one copy of the demo page, and the actions of a human and an agent. */
export const test = base.extend<{
  humagent: Awaited<ReturnType<typeof createHumagent>>;
  pageErrors: void;
}>({
  humagent: async ({ page }, use) => {
    const directory = fixture('browser');
    const humagent = await createHumagent(page, directory);
    try {
      await use(humagent);
    } finally {
      await humagent.close();
      fs.rmSync(directory, { recursive: true, force: true });
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

async function createHumagent(page: Page, directory: string) {
  const state = path.join(directory, 'state');
  const file = path.join(directory, 'examples/index.html');
  fs.cpSync(
    fileURLToPath(new URL('../../dist/examples/', import.meta.url)),
    path.dirname(file),
    { recursive: true },
  );
  let runtime = await createServer({ directory: state });
  let id = '';
  let key = '';
  let wait: Promise<Delivered> | undefined;
  const agent = new AbortController();
  const frame = page.frameLocator('#frame');
  const note = frame.getByLabel('Comment', { exact: true });
  const editor = frame.getByRole('textbox', { name: 'Edit text', exact: true });
  const toggle = page.locator('#bar-toggle');
  const pageFrame = (): Frame =>
    page.frames().find((child) => child.parentFrame() === page.mainFrame())!;

  /** Call a control route with the agent's credential. */
  async function api<T>(route: string, method: string, data?: unknown) {
    const response = await fetch(runtime.origin + route, {
      method,
      signal: agent.signal,
      headers: {
        authorization: `Bearer ${runtime.token}`,
        'content-type': 'application/json',
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const body = await response.text();
    expect(response.ok, `${method} ${route}: ${body}`).toBeTruthy();
    return JSON.parse(body) as T;
  }
  async function ready() {
    await expect(page.locator('#bridge-status')).toHaveText('Page connected');
    await pageFrame().waitForFunction(() => !!window.humagent);
  }
  /** Open the bar, which turns annotating on. Or close it, which turns annotating off. */
  async function annotate(on = true) {
    if ((await toggle.getAttribute('aria-pressed')) !== String(on))
      await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', String(on));
    await expect(toggle).toHaveAttribute('aria-expanded', String(on));
  }
  async function confirm() {
    await frame
      .getByRole('button', { name: /^(Add comment|Confirm text edit|Save)$/ })
      .click();
    await expect(frame.getByRole('dialog', { name: 'Review' })).toBeHidden();
  }

  return {
    file,
    frame,
    annotate,
    ready,
    get origin() {
      return runtime.origin;
    },
    /** The credential that the opened URL gives to the browser page. */
    get key() {
      return key;
    },
    /** The server's saved state of the open session. */
    session: () => runtime.store.get(id),
    evaluate: ((...args: Parameters<Frame['evaluate']>) =>
      pageFrame().evaluate(...args)) as Frame['evaluate'],
    /** Open a source. The bar starts closed. Return the session ID. */
    async open(source = file) {
      const opened = await api<{ session: string; url: string }>(
        '/api/open',
        'POST',
        { source },
      );
      id = opened.session;
      key = new URL(opened.url).hash.slice(1);
      await page.goto(opened.url);
      await ready();
      return id;
    },
    async addComment(selector: string, comment: string) {
      await annotate();
      await frame.locator(selector).click();
      await note.fill(comment);
      await confirm();
    },
    /** Select the complete first text node of an element, as a drag does. Resolve after the page handled it. */
    async selectText(selector: string) {
      await annotate();
      await pageFrame().evaluate(
        (selector) =>
          new Promise<void>((resolve) => {
            const element = document.querySelector(selector)!;
            const range = document.createRange();
            range.selectNodeContents(element.firstChild!);
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            // The page reads the selection in a timer. A later timer runs after it.
            setTimeout(resolve, 0);
          }),
        selector,
      );
    },
    /** Replace the complete first text node of an element. */
    async replace(selector: string, after: string) {
      await this.selectText(selector);
      await editor.fill(after);
      await confirm();
    },
    /** Start an agent wait. `receive` returns its feedback. */
    async connect() {
      wait = api<Delivered>(`/api/sessions/${id}/wait`, 'POST', {});
      wait.catch(() => {});
      await expect(page.locator('#agent-state')).toHaveText('Agent connected');
    },
    async receive() {
      const delivered = await wait!;
      expect(delivered.status).toBe('feedback');
      return delivered;
    },
    /** Complete the receipt, as the agent does after it applies the feedback. */
    complete: (delivered: Delivered) =>
      api(`/api/sessions/${id}/complete`, 'POST', {
        receipt: delivered.receipt,
      }),
    async restart() {
      await runtime.close();
      runtime = await createServer({ directory: state });
    },
    async close() {
      agent.abort();
      await runtime.close();
    },
  };
}

export { expect };
