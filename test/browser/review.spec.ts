import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures.ts';

test('a text edit, a comment, and form choices reach the agent as one event without changing source', async ({
  page,
  review,
}) => {
  const source = fs.readFileSync(review.file, 'utf8');
  await review.open();
  const heading = review.frame.locator('h1');
  const headline = await heading.textContent();
  await review.replace('h1', 'Give your agent a clearer plan.');
  await review.addComment('.mock-cta', 'Make this button stand out.');
  await review.annotate(false);
  const choice = review.frame.getByRole('radio', { name: 'Split' });
  await choice.check();
  await review.frame.getByRole('radio', { name: 'Outline' }).check();
  await review.frame.getByRole('radio', { name: /The interactions/ }).check();
  const values = { layout: 'split', button: 'outline', workflow: 'behavior' };
  await expect
    .poll(() => review.session().drafts.at(-1)?.item.values)
    .toEqual(values);
  expect(review.session().drafts).toHaveLength(3);
  expect(review.session().events).toHaveLength(0);

  await page.reload();
  await review.ready();
  await expect(choice).toBeChecked();
  await page.locator('#message').fill('Apply these together.');
  await review.connect();
  await page.locator('#send').click();
  const feedback = await review.receive();
  expect(feedback.events).toHaveLength(1);
  const [event] = feedback.events;
  expect(event.message).toBe('Apply these together.');
  expect(event.revision).toBe(review.session().revision);
  expect(event.items).toMatchObject([
    { replacement: { after: 'Give your agent a clearer plan.' } },
    { comment: 'Make this button stand out.' },
    { values },
  ]);
  expect(feedback.target).toEqual({ kind: 'file', value: review.file });

  // The preview stays until the agent acknowledges its receipt.
  await expect(heading).toHaveText('Give your agent a clearer plan.');
  await review.acknowledge(feedback);
  await expect(heading).toHaveText(headline!);
  expect(fs.readFileSync(review.file, 'utf8')).toBe(source);
});

test('sending requires a waiting agent, and an ended session accepts no input', async ({
  page,
  review,
}) => {
  await review.open();
  const send = page.locator('#send');
  const status = page.locator('#agent-state');
  await page.locator('#message').fill('Review this');
  await expect(status).toHaveText('No agent waiting');
  await expect(send).toBeDisabled();
  await send.dispatchEvent('click');
  await expect(page.locator('#error')).toContainText('Connect an agent');
  expect(review.session().events).toHaveLength(0);

  await review.connect();
  await send.click();
  const feedback = await review.receive();
  expect(feedback.events[0].message).toBe('Review this');
  await expect(status).toHaveText('Agent working');
  await review.acknowledge(feedback);
  await expect(status).toHaveText('No agent waiting');
  await expect(send).toBeDisabled();

  await review.expand(true);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(status).toHaveText('Session ended');
  await expect(page.locator('#message')).toBeDisabled();
});

test('a server restart keeps drafts, the instruction, and form choices', async ({
  page,
  review,
}) => {
  const session = await review.open();
  await review.addComment('h1', 'Keep this draft.');
  await review.annotate(false);
  const choice = review.frame.getByRole('radio', { name: 'Split' });
  await choice.check();
  await page.locator('#message').fill('Keep this unsent message.');
  await expect
    .poll(() => review.session().message)
    .toBe('Keep this unsent message.');
  await expect.poll(() => review.session().drafts.length).toBe(2);

  await review.restart();
  expect(await review.open()).toBe(session);
  await expect(page.locator('#message')).toHaveValue(
    'Keep this unsent message.',
  );
  await expect(page.locator('.draft')).toHaveCount(2);
  await expect(
    page.locator('.draft', { hasText: 'Keep this draft.' }),
  ).toHaveCount(1);
  await expect(choice).toBeChecked();
});

test('a source change marks saved feedback as stale and blocks sending', async ({
  page,
  review,
}) => {
  await review.open();
  await review.addComment('h1', 'Preserve this note.');
  await review.connect();
  await expect(page.locator('#send')).toBeEnabled();
  fs.appendFileSync(review.file, '<p>Changed source.</p>');
  await expect(review.frame.getByText('Changed source.')).toBeVisible();
  await expect(page.locator('.draft-status')).toContainText('Stale revision');
  await expect(page.locator('.draft')).toContainText('Preserve this note.');
  await expect(page.locator('#send')).toBeDisabled();
  expect(review.session().events).toHaveLength(0);
});

test('the page under review cannot use control routes, learn the session key, or stage through a foreign message', async ({
  page,
  review,
}) => {
  await review.open();
  await page.evaluate(() =>
    window.postMessage(
      {
        method: 'stage',
        id: 'foreign',
        params: { item: { values: { evil: true } } },
      },
      location.origin,
    ),
  );
  const denied = await review.evaluate(async (origin) => {
    try {
      return (await fetch(`${origin}/api/sessions`)).status;
    } catch {
      return 'blocked';
    }
  }, review.origin);
  expect([403, 'blocked']).toContain(denied);
  expect(review.key).not.toBe('');
  expect(
    await review.evaluate(() => JSON.stringify(window.__HUMAGENT__)),
  ).not.toContain(review.key);
  const sandbox = await page.locator('#frame').getAttribute('sandbox');
  expect(sandbox).not.toContain('allow-top-navigation');
  expect(sandbox).not.toContain('allow-popups');
  // A comment that stages after the foreign message proves that the message staged nothing.
  await review.addComment('h1', 'The only draft');
  expect(review.session().drafts).toHaveLength(1);
});

test('a proxied app keeps its own behavior and accepts comments and SDK submissions', async ({
  page,
  review,
}) => {
  const app = http.createServer((request, response) => {
    if (request.url === '/api/value')
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
        .end(
          '<!doctype html><h1 id="headline">A page that was already here.</h1><button id="counter">Count: 0</button><script type="module" src="/app.js"></script>',
        );
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  try {
    const target = `http://127.0.0.1:${(app.address() as AddressInfo).port}/`;
    await review.open(target);
    await review.frame.locator('#counter').click();
    await expect(review.frame.locator('#counter')).toHaveText('Count: 1');
    expect(
      await review.evaluate(async () => (await fetch('/api/value')).json()),
    ).toEqual({ v: 42 });
    await review.addComment('#headline', 'Review an existing app.');
    const staged = await review.evaluate(() =>
      window.humagent.submit({ values: { choice: 'keep' } }),
    );
    expect(staged.status).toBe('draft');
    await review.connect();
    await page.locator('#send').click();
    const feedback = await review.receive();
    expect(feedback.target.kind).toBe('url');
    expect(feedback.events[0].items).toMatchObject([
      { target: { id: 'headline' }, comment: 'Review an existing app.' },
      { values: { choice: 'keep' } },
    ]);
  } finally {
    app.closeAllConnections();
    app.close();
  }
});
