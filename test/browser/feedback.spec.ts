import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures.ts';

test('a text edit, a comment, and form choices reach the agent as one feedback without changing source', async ({
  page,
  humagent,
}) => {
  const source = fs.readFileSync(humagent.file, 'utf8');
  await humagent.open();
  const heading = humagent.frame.locator('h1');
  const headline = await heading.textContent();
  await humagent.replace('h1', 'Give your agent a clearer plan.');
  await humagent.addComment('.mock-cta', 'Make this button stand out.');
  await humagent.annotate(false);
  const choice = humagent.frame.getByRole('radio', { name: 'Split' });
  const formStatus = humagent.frame.locator('[data-humagent-form-status]');
  await choice.evaluate((el) => el.setAttribute('name', 'prototype'));
  await choice.check();
  await expect(formStatus).toHaveText('Reserved field name');
  await expect(page.locator('#error')).toHaveText('Reserved field name');
  expect(humagent.session().pending).toHaveLength(2);
  await choice.evaluate((el) => el.setAttribute('name', 'layout'));
  await humagent.frame.getByRole('radio', { name: 'Outline' }).check();
  await expect(formStatus).toBeEmpty();
  await expect(page.locator('#error')).toBeHidden();
  await humagent.frame.getByRole('radio', { name: /The interactions/ }).check();
  const values = { layout: 'split', button: 'outline', workflow: 'behavior' };
  await expect
    .poll(() => humagent.session().pending.at(-1)?.review.data)
    .toEqual(values);
  expect(humagent.session().pending).toHaveLength(3);
  expect(humagent.session().feedback).toHaveLength(0);

  await page.reload();
  await humagent.ready();
  await expect(choice).toBeChecked();
  // The bar starts closed. Its button opens it and turns annotating on.
  await expect(page.locator('#instruction')).toBeHidden();
  await expect(page.locator('#toggle-count')).toHaveText('3');
  await humagent.annotate();
  await page.locator('#instruction').fill('Apply these together.');
  await humagent.connect();
  await expect.poll(() => humagent.session().instruction).not.toBe('');
  // Send waits for typed form text that is not saved yet.
  await humagent.evaluate(() => {
    const form = document.querySelector('form')!;
    form.append(
      Object.assign(document.createElement('input'), { name: 'note' }),
    );
  });
  await Promise.all([
    humagent.frame.locator('[name=note]').evaluate((el: HTMLInputElement) => {
      el.value = 'Typed last.';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }),
    page.locator('#send').click(),
  ]);
  const delivered = await humagent.receive();
  expect(delivered.feedback).toHaveLength(1);
  const [sent] = delivered.feedback;
  expect(sent.instruction).toBe('Apply these together.');
  expect(sent.revision).toBe(humagent.session().revision);
  expect(sent.reviews).toMatchObject([
    { kind: 'edit', data: { after: 'Give your agent a clearer plan.' } },
    { kind: 'comment', comment: 'Make this button stand out.' },
    {
      kind: 'form',
      comment: expect.stringMatching(/^Apply these/),
      data: { ...values, note: 'Typed last.' },
    },
  ]);
  // `data` comes before `target`. An edit without a note has no `comment`.
  expect(sent.reviews.map((review) => Object.keys(review).join())).toEqual([
    'id,kind,data,target',
    'id,kind,comment,target',
    'id,kind,comment,data',
  ]);
  expect(delivered.source).toEqual({ kind: 'file', value: humagent.file });
  // Pending review data for the page and the bar stays on the server.
  expect(JSON.stringify(delivered)).not.toMatch(/"(local|marker|labels)"/);

  // Text that shows a sent preview takes no new edit.
  await humagent.selectText('h1');
  await expect(
    humagent.frame.getByRole('textbox', { name: 'Edit text', exact: true }),
  ).toHaveCount(0);
  await expect(
    humagent.frame.getByRole('dialog', { name: 'Review' }),
  ).toBeHidden();
  await humagent.annotate(false);

  // The preview stays until the agent acknowledges its receipt.
  await expect(heading).toHaveText('Give your agent a clearer plan.');
  await humagent.complete(delivered);
  await expect(heading).toHaveText(headline!);
  expect(fs.readFileSync(humagent.file, 'utf8')).toBe(source);
});

test('the keyboard picks an element, a marker reopens its review, a noted text pick saves a comment, and two outside presses discard input', async ({
  page,
  humagent,
}) => {
  await humagent.open();
  const frame = humagent.frame;
  const dialog = frame.getByRole('dialog', { name: 'Review' });
  const note = frame.getByLabel('Comment', { exact: true });
  const hint = frame.locator('#keyboard-hint');
  const toggle = page.locator('#bar-toggle');
  const headline = await frame.locator('h1').textContent();

  // Keyboard: the toggle starts at the first element. Arrows move. Enter opens feedback.
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(hint).toContainText('Element 1 of');
  await page.keyboard.press('ArrowDown');
  await expect(hint).toContainText('Element 2 of');
  await page.keyboard.press('Enter');
  await expect(note).toBeFocused();
  await page.keyboard.type('Picked with the keyboard.');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  expect(humagent.session().pending).toHaveLength(1);
  const picked = humagent.session().pending[0].review;
  expect(picked).toMatchObject({
    kind: 'comment',
    comment: 'Picked with the keyboard.',
  });
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toBeFocused();

  // A marker reopens its pending review. Saving keeps the review and returns focus to the marker.
  const marker = frame.getByRole('button', { name: /^Review 1:/ });
  await marker.click();
  await expect(note).toHaveValue('Picked with the keyboard.');
  await note.fill('Changed through the marker.');
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(marker).toBeFocused();
  expect(humagent.session().pending.map((saved) => saved.review)).toMatchObject(
    [
      {
        id: picked.id,
        kind: 'comment',
        comment: 'Changed through the marker.',
      },
    ],
  );

  // A text pick with only a note saves a comment, not an edit.
  await humagent.selectText('h1');
  await expect(
    frame.getByRole('textbox', { name: 'Edit text', exact: true }),
  ).toBeVisible();
  await note.fill('Only a note on this text.');
  await frame.getByRole('button', { name: 'Confirm text edit' }).click();
  await expect(dialog).toBeHidden();
  const noted = humagent.session().pending[1].review;
  expect(Object.keys(noted)).toEqual(['id', 'kind', 'comment', 'target']);
  expect(noted).toMatchObject({
    kind: 'comment',
    comment: 'Only a note on this text.',
  });
  await expect(frame.locator('h1')).toHaveText(headline!);

  // The first outside press keeps unfinished input. The second discards it.
  await frame.locator('.mock-cta').click();
  await note.fill('Unfinished note.');
  await frame.locator('h1').click();
  await expect(dialog).toBeVisible();
  await expect(note).toHaveValue('Unfinished note.');
  await frame.locator('h1').click();
  await expect(dialog).toBeHidden();
  expect(humagent.session().pending).toHaveLength(2);
});

test('sending requires a connected agent, and an ended session accepts no input', async ({
  page,
  humagent,
}) => {
  await humagent.open();
  const send = page.locator('#send');
  const status = page.locator('#agent-state');
  const heading = humagent.frame.locator('h1');
  await heading.evaluate((el) => {
    el.style.userSelect = 'none';
  });
  await humagent.annotate();
  await expect(heading).toHaveCSS('user-select', 'text');
  await page.locator('#instruction').fill('Check this');
  await expect(status).toHaveText('No agent connected');
  await expect(send).toBeDisabled();
  await send.dispatchEvent('click');
  await expect(page.locator('#error')).toContainText('Connect an agent');
  expect(humagent.session().feedback).toHaveLength(0);

  await humagent.connect();
  // A failed save keeps the typed instruction, and Send saves it first.
  const instruction = page.locator('#instruction');
  await page.route('**/api/sessions/*/instruction', (route) => route.abort(), {
    times: 1,
  });
  await instruction.fill('Check this again');
  await expect(page.locator('#instruction-status')).toHaveText('Not saved');
  await instruction.blur();
  await page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes('/api/sessions/'),
  );
  await expect(instruction).toHaveValue('Check this again');
  expect(humagent.session().instruction).toBe('Check this');
  await send.click();
  const delivered = await humagent.receive();
  expect(delivered.feedback[0].instruction).toBe('Check this again');
  await expect(instruction).toHaveValue('');
  // A delivered event means that the agent works on it.
  await expect(status).toHaveText('Agent working');
  await humagent.complete(delivered);
  await expect(status).toHaveText('No agent connected');
  await expect(send).toBeDisabled();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(status).toHaveText('Session ended');
  await expect(page.locator('#instruction')).toBeDisabled();
  await expect(heading).toHaveCSS('user-select', 'none');
});

test('a server restart keeps pending reviews, the instruction, and form choices', async ({
  page,
  humagent,
}) => {
  const session = await humagent.open();
  await humagent.addComment('h1', 'Keep this saved.');
  await humagent.annotate(false);
  const choice = humagent.frame.getByRole('radio', { name: 'Split' });
  await choice.check();
  await humagent.annotate();
  await page.locator('#instruction').fill('Keep this unsent instruction.');
  await expect
    .poll(() => humagent.session().instruction)
    .toBe('Keep this unsent instruction.');
  await expect.poll(() => humagent.session().pending.length).toBe(2);

  await humagent.restart();
  expect(await humagent.open()).toBe(session);
  await expect(page.locator('#instruction')).toHaveValue(
    'Keep this unsent instruction.',
  );
  await expect(page.locator('.review')).toHaveCount(2);
  await expect(
    page.locator('.review', { hasText: 'Keep this saved.' }),
  ).toHaveCount(1);
  await expect(choice).toBeChecked();
  await humagent.annotate();
  await page.getByRole('button', { name: 'Delete review 2' }).click();
  await expect(page.locator('.review')).toHaveCount(1);
  await expect(choice).not.toBeChecked();
});

test('a stale form review blocks Send and its removal preserves the current form', async ({
  page,
  humagent,
}) => {
  await humagent.open();
  const choice = humagent.frame.getByRole('radio', { name: 'Split' });
  await choice.check();
  await humagent.annotate();
  await humagent.connect();
  await expect(page.locator('#send')).toBeEnabled();
  fs.appendFileSync(humagent.file, '<p>Changed source.</p>');
  await expect(humagent.frame.getByText('Changed source.')).toBeVisible();
  await expect(page.locator('.review-status')).toContainText('Stale revision');
  await expect(page.locator('.review')).toContainText('Split');
  await expect(page.locator('#send')).toBeDisabled();
  expect(humagent.session().feedback).toHaveLength(0);
  // The application sets the field on the new revision.
  await choice.evaluate((input: HTMLInputElement) => {
    input.checked = true;
  });
  await page.getByRole('button', { name: 'Delete review 1' }).click();
  await expect(page.locator('.review')).toHaveCount(0);
  await expect(choice).toBeChecked();

  // Input that failed to save blocks the automatic reload. A manual reload still works.
  await page.route('**/api/sessions/*/reviews', (route) => route.abort(), {
    times: 1,
  });
  await choice.dispatchEvent('change');
  await expect(
    humagent.frame.locator('[data-humagent-form-status]'),
  ).not.toBeEmpty();
  fs.appendFileSync(humagent.file, '<p>Changed again.</p>');
  await expect(page.locator('#update')).toBeVisible();
  await expect(choice).toBeChecked();
  await page.locator('#update').getByRole('button').click();
  await expect(humagent.frame.getByText('Changed again.')).toBeVisible();
});

test('the page cannot use control routes, learn the session key, save through a foreign message, or save a review that breaks its plugin rules', async ({
  page,
  humagent,
}) => {
  await humagent.open();
  await page.evaluate(() =>
    window.postMessage(
      {
        method: 'save',
        id: 'foreign',
        params: { review: { kind: 'form', data: { evil: true } } },
      },
      location.origin,
    ),
  );
  const denied = await humagent.evaluate(async (origin) => {
    try {
      return (await fetch(`${origin}/api/sessions`)).status;
    } catch {
      return 'blocked';
    }
  }, humagent.origin);
  expect([403, 'blocked']).toContain(denied);
  expect(humagent.key).not.toBe('');
  const html = await humagent.evaluate(
    () => document.documentElement.outerHTML,
  );
  expect(html).toContain('__humagent-bootstrap');
  expect(html).not.toContain(humagent.key);
  const sandbox = await page.locator('#frame').getAttribute('sandbox');
  expect(sandbox).not.toContain('allow-top-navigation');
  expect(sandbox).not.toContain('allow-popups');
  // The workspace applies each plugin's rules to what the page sends.
  expect(
    await humagent.evaluate(() =>
      window.humagent.submit({ data: 'not an object' } as never).then(
        () => 'saved',
        (error: Error) => error.message,
      ),
    ),
  ).toContain('Form must be an object');
  // A page that posts its own messages cannot add local data that the plugin does not define.
  expect(
    await humagent.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const boot = JSON.parse(
            document.getElementById('__humagent-bootstrap')!.textContent!,
          );
          window.addEventListener('message', ({ data }) => {
            if (data.id === 'local') resolve(data.error ?? 'saved');
          });
          parent.postMessage(
            {
              channel: boot.channel,
              documentId: boot.documentId,
              revision: boot.revision,
              method: 'save',
              id: 'local',
              params: {
                review: {
                  kind: 'comment',
                  comment: 'x',
                  target: { selector: 'h1' },
                },
                local: { marker: { x: 0, y: 0 }, extra: true },
              },
            },
            boot.parentOrigin,
          );
        }),
    ),
  ).toContain('cannot include local data');
  // A comment that saves after the foreign message proves that the message saved nothing.
  await humagent.addComment('h1', 'The only saved');
  expect(humagent.session().pending).toHaveLength(1);
});

test('a proxied app keeps its own behavior and accepts comments and SDK submissions', async ({
  page,
  humagent,
}) => {
  let events: http.ServerResponse;
  let streamClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    streamClosed = resolve;
  });
  const app = http.createServer((request, response) => {
    if (request.url === '/events') {
      events = response;
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
      });
      response.flushHeaders();
      response.on('close', streamClosed);
    } else if (request.url === '/events/release') {
      events.write('data: delivered\n\n');
      response.end();
    } else if (request.url === '/api/value')
      response.setHeader('content-type', 'application/json').end('{"v":42}');
    else if (request.url === '/app.js')
      response
        .setHeader('content-type', 'text/javascript')
        .end(
          'let n = 0; const b = document.querySelector("#counter"); b.onclick = () => (b.textContent = `Count: ${++n}`);',
        );
    else
      response
        .setHeader('content-type', 'text/html')
        // The app allows no inline script.
        .setHeader('content-security-policy', "script-src 'self'")
        .end(
          '<!doctype html><h1 id="headline">A page that was already here.</h1><button id="blocked">Skip me</button><button id="counter">Count: 0</button><script type="module" src="/app.js"></script>',
        );
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  try {
    const source = `http://127.0.0.1:${(app.address() as AddressInfo).port}/`;
    // The first tool blocks a button whose text the edit tool would accept.
    await page.route('**/__humagent/plugins/index.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `
          import { plugins as builtins } from './index.js?builtins';
          const tool = {
            name: 'Block',
            hit: ({ el }) => el.id === 'blocked' ? 'blocked' : undefined,
          };
          export const plugins = new Map([['block', { page: () => ({ tool }) }], ...builtins]);
        `,
      }),
    );
    await humagent.open(source);
    const counter = humagent.frame.locator('#counter');
    await humagent.annotate();
    const blocked = humagent.frame.getByRole('button', { name: 'Skip me' });
    await blocked.click();
    await expect(blocked).not.toBeFocused();
    await expect(
      humagent.frame.getByRole('dialog', { name: 'Review' }),
    ).toBeHidden();
    await humagent.replace('#counter', 'Count visitors');
    const reopen = page.getByRole('button', {
      name: 'Edit review 1',
      exact: true,
    });
    await page.getByRole('group', { name: 'Text changes' }).click();
    const editor = counter.getByRole('textbox', { name: 'Edit text' });
    await expect(editor).toHaveText('Count visitors');
    await editor.press('Escape');
    await humagent.annotate(false);
    await counter.click();
    await expect(counter).toHaveText('Count: 1');
    await humagent.annotate();
    await reopen.click();
    await expect(page.locator('#error')).toContainText('Target unavailable');
    await expect(editor).toHaveCount(0);
    await expect(counter).toHaveText('Count: 1');
    expect(
      await humagent.evaluate(async () => (await fetch('/api/value')).json()),
    ).toEqual({ v: 42 });
    // Open must arrive before any event data. Closing the browser stream releases upstream.
    expect(
      await humagent.evaluate(
        () =>
          new Promise<string>((resolve, reject) => {
            const stream = new EventSource('/events');
            stream.onopen = () => {
              void fetch('/events/release').catch(reject);
            };
            stream.onmessage = (event) => {
              stream.close();
              resolve(event.data);
            };
            stream.onerror = () => {
              stream.close();
              reject(new Error('Event stream disconnected'));
            };
          }),
      ),
    ).toBe('delivered');
    await closed;
    await humagent.addComment('#headline', 'Comment on an existing app.');
    // Two elements now claim the same saved ID. Reopening requires one match.
    const openComment = page.getByRole('button', { name: 'Edit review 2' });
    await counter.evaluate((el) =>
      el.setAttribute('data-humagent-id', 'headline'),
    );
    await expect(openComment).toBeDisabled();
    await counter.evaluate((el) => el.removeAttribute('data-humagent-id'));
    await expect(openComment).toBeEnabled();
    const saved = await humagent.evaluate(() =>
      window.humagent.submit({ data: { choice: 'keep' } }),
    );
    expect(saved.status).toBe('pending');
    await humagent.connect();
    await page.locator('#send').click();
    const delivered = await humagent.receive();
    expect(delivered.source.kind).toBe('url');
    expect(delivered.feedback[0].reviews).toMatchObject([
      { kind: 'edit', data: { before: 'Count: 0', after: 'Count visitors' } },
      {
        kind: 'comment',
        comment: 'Comment on an existing app.',
        target: { id: 'headline' },
      },
      { kind: 'form', data: { choice: 'keep' } },
    ]);
    // An SDK submission belongs to no form, so it has no target.
    expect(Object.keys(delivered.feedback[0].reviews[2])).toEqual([
      'id',
      'kind',
      'data',
    ]);
  } finally {
    app.closeAllConnections();
    app.close();
  }
});
