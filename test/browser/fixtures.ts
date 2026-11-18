import { test as base, expect, type Frame, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../../dist/runtime/server.js';
import type { Feedback } from '../../dist/shared/feedback.js';
import { fixture } from '../fixtures.ts';

/** One server, one copy of the demo page, and the actions of a reviewer and an agent. */
export const test = base.extend<{
  review: Awaited<ReturnType<typeof createReview>>;
  pageErrors: void;
}>({
  review: async ({ page }, use) => {
    const directory = fixture('browser');
    const review = await createReview(page, directory);
    try {
      await use(review);
    } finally {
      await review.close();
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

async function createReview(page: Page, directory: string) {
  const state = path.join(directory, 'state');
  const file = path.join(directory, 'examples/plan.html');
  fs.cpSync(
    fileURLToPath(new URL('../../dist/examples/', import.meta.url)),
    path.dirname(file),
    { recursive: true },
  );
  let runtime = await createRuntime({ directory: state });
  let id = '';
  let key = '';
  let wait: Promise<Feedback> | undefined;
  const agent = new AbortController();
  const frame = page.frameLocator('#frame');
  const note = frame.getByLabel('Comment', { exact: true });
  const editor = frame.getByRole('textbox', { name: 'Edit text', exact: true });
  const annotateButton = page.locator('#annotate');
  const toggle = page.locator('#toggle-review');
  const surface = (): Frame =>
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
    await expect(page.locator('#bridge-status')).toHaveText(
      'Interface connected',
    );
    await surface().waitForFunction(() => !!window.humagent);
  }
  async function expand(open: boolean) {
    if ((await toggle.getAttribute('aria-expanded')) !== String(open))
      await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', String(open));
  }
  /** Turn commenting on or off. */
  async function annotate(on = true) {
    if ((await annotateButton.getAttribute('aria-pressed')) !== String(on))
      await annotateButton.click();
    await expect(annotateButton).toHaveAttribute('aria-pressed', String(on));
  }
  async function confirm() {
    await frame
      .getByRole('button', { name: /^(Add comment|Confirm text edit|Save)$/ })
      .click();
    await expect(frame.getByRole('dialog', { name: 'Feedback' })).toBeHidden();
  }

  return {
    file,
    frame,
    expand,
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
      surface().evaluate(...args)) as Frame['evaluate'],
    /** Open a source with the review details closed. Return the session ID. */
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
      await expand(false);
      return id;
    },
    async addComment(selector: string, comment: string) {
      await annotate();
      await frame.locator(selector).click();
      await note.fill(comment);
      await confirm();
    },
    /** Replace the complete first text node of an element. */
    async replace(selector: string, after: string) {
      await annotate();
      await surface().evaluate((selector) => {
        const element = document.querySelector(selector)!;
        const range = document.createRange();
        range.selectNodeContents(element.firstChild!);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }, selector);
      await editor.fill(after);
      await confirm();
    },
    /** Start an agent wait. `receive` returns its feedback. */
    async connect() {
      wait = api<Feedback>(`/api/sessions/${id}/wait`, 'POST', {});
      wait.catch(() => {});
      await expect(page.locator('#agent-state')).toHaveText('Agent connected');
    },
    async receive() {
      const feedback = await wait!;
      expect(feedback.status).toBe('feedback');
      return feedback;
    },
    acknowledge: (feedback: Feedback) =>
      api(`/api/sessions/${id}/ack`, 'POST', { receipt: feedback.receipt }),
    async restart() {
      await runtime.close();
      runtime = await createRuntime({ directory: state });
    },
    async close() {
      agent.abort();
      await runtime.close();
    },
  };
}

export { expect };
