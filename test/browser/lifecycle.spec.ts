import { test, expect } from './fixtures.ts';

test('new document can stage before an older snapshot response returns', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const opened = await review.open(app.origin + '/a');
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false,
    finished = false;
  await page.route(`**/api/sessions/${opened.session}`, async (route) => {
    if (held) return route.continue();
    const response = await route.fetch();
    held = true;
    await delayed;
    await route.fulfill({ response });
    finished = true;
  });
  try {
    await expect.poll(() => held).toBe(true);
    await review.frame.locator('a').click();
    await expect(review.frame.locator('h1')).toHaveText('Page b');
    await review.ready();
    const result = await review.evaluate(() =>
      window.humagent.submit({ intent: 'current-page', values: { page: 'b' } }),
    );
    expect(result.status).toBe('draft');
    release();
    await expect.poll(() => finished).toBe(true);
    await review.connect();
    await expect(page.locator('#send')).toBeEnabled();
    await page.locator('#send').click();
    await review.events(1);
    expect(workspace.store.get(opened.session).surfacePath).toBe('/b');
  } finally {
    release();
  }
});

test('a slow attach of an older page cannot replace the newer page', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const opened = await review.open(app.origin + '/a');
  let held = false;
  await page.route(
    `**/api/sessions/${opened.session}/surface`,
    async (route) => {
      if (held) return route.continue();
      held = true;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ response });
    },
  );
  await review.evaluate(() => location.reload());
  await expect.poll(() => held).toBe(true);
  await review.evaluate(() => {
    location.href = '/b';
  });
  await expect(review.frame.locator('h1')).toHaveText('Page b');
  await review.ready();
  const result = await review.evaluate(() =>
    window.humagent.submit({ intent: 'current', values: { page: 'b' } }),
  );
  expect(result.status).toBe('draft');
  expect(workspace.store.get(opened.session).surfacePath).toBe('/b');
  await review.connect();
  await page.locator('#send').click();
  expect((await review.events(1))[0].items[0].values).toEqual({ page: 'b' });
});

test('existing apps keep native clicks, API requests, nested frames, and annotations', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const opened = await review.open(app.origin + '/nested');
  const before = workspace.store.get(opened.session);
  await review.frame.locator('#counter').click();
  await expect(review.frame.locator('#counter')).toHaveText('Count: 1');
  expect(
    await review.evaluate(async () => (await fetch('/api/value')).json()),
  ).toEqual({ value: 42 });
  await review.evaluate(() => {
    const child = document.createElement('iframe');
    child.id = 'child';
    child.src = '/b';
    document.body.append(child);
  });
  const child = review.frame.frameLocator('#child');
  await expect(child.locator('h1')).toHaveText('Page b');
  await expect(child.locator('input')).toBeVisible();
  expect(
    await child.locator('body').evaluate(() => ({
      sdk: typeof window.humagent,
      boot: typeof window.__HUMAGENT__,
    })),
  ).toEqual({ sdk: 'undefined', boot: 'undefined' });
  expect(workspace.store.get(opened.session).revision).toBe(before.revision);
  expect(workspace.store.get(opened.session).surfacePath).toBe('/nested');
  await review.addComment('#headline', 'Review an existing app.');
  await review.connect();
  await page.locator('#send').click();
  const [event] = await review.events(1);
  expect(event.items[0].target!.id).toBe('headline');
  expect(event.revision).toBe(before.revision);
});

test('a server restart keeps drafts, the instruction, and form values', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.frame
    .locator('input[name="outcome"]')
    .fill('A preserved outcome.');
  await review.frame.locator('input[name="outcome"]').blur();
  await expect
    .poll(() => workspace.form(plan.session, 'launch')?.outcome)
    .toBe('A preserved outcome.');
  await review.addComment('h1', 'Keep this draft.');
  await page.locator('#message').fill('Keep this unsent message.');
  await expect
    .poll(() => workspace.store.get(plan.session).message)
    .toBe('Keep this unsent message.');
  await workspace.restart();
  const resumed = await review.open();
  expect(resumed.session).toBe(plan.session);
  await expect(page.locator('#message')).toHaveValue(
    'Keep this unsent message.',
  );
  await expect(
    page.locator('.draft', { hasText: 'Keep this draft.' }),
  ).toHaveCount(1);
  await expect(page.locator('.draft')).toHaveCount(2);
  await expect(review.frame.locator('input[name="outcome"]')).toHaveValue(
    'A preserved outcome.',
  );
});

test('browser reload retains saved form state and the displayed route', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const session = await review.open(app.origin + '/a');
  await review.frame.locator('a').click();
  await expect(review.frame.locator('h1')).toHaveText('Page b');
  await review.ready();
  // Typed text that never lost focus is saved when the page unloads.
  await review.frame.locator('input[name="note"]').fill('Save before reload.');
  await review.expand();
  await Promise.all([
    page.waitForEvent(
      'framenavigated',
      (frame) => frame.parentFrame() === page.mainFrame(),
    ),
    review.evaluate(() => location.reload()),
  ]);
  await review.ready();
  expect(await review.evaluate(() => location.pathname)).toBe('/b');
  await expect(review.frame.locator('h1')).toHaveText('Page b');
  await expect(review.frame.locator('input[name="note"]')).toHaveValue(
    'Save before reload.',
  );
  expect(workspace.form(session.session, 'route')?.note).toBe(
    'Save before reload.',
  );
  expect(workspace.store.get(session.session).surfacePath).toBe('/b');
});

test('HTML fragment fetches preserve the displayed app and allow submissions', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const opened = await review.open(app.origin + '/a');
  const before = await workspace.api(`/api/sessions/${opened.session}`);
  const fragment = await review.evaluate(async () => {
    const response = await fetch('/fragment');
    return {
      text: await response.text(),
      encoding: response.headers.get('content-encoding'),
    };
  });
  expect(fragment).toEqual({
    text: '<p>Unchanged HTML fragment</p>',
    encoding: 'gzip',
  });
  const after = await workspace.api(`/api/sessions/${opened.session}`);
  expect(after.revision).toBe(before.revision);
  expect(after.surface.frameUrl).toBe(before.surface.frameUrl);
  expect(await review.evaluate(() => location.pathname)).toBe('/a');
  const event = await review.evaluate(() =>
    window.humagent.submit({ intent: 'review', values: { choice: 'keep' } }),
  );
  expect(event.status).toBe('draft');
  expect(workspace.store.get(opened.session).events).toHaveLength(0);
  await review.connect();
  await page.locator('#send').click();
  await review.events(1);
  await expect(page.locator('#error')).toBeHidden();
});

test('dynamic HTML accepts submissions without a refresh loop', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const session = await review.open(app.origin + '/dynamic');
  const requests = app.dynamicRequests;
  await review.frame
    .locator('form[data-humagent-intent] button[type="submit"]')
    .click();
  await expect(page.locator('.draft')).toHaveCount(1);
  await review.connect();
  await page.locator('#send').click();
  await review.events(1);
  const deadline = Date.now() + 600;
  await expect
    .poll(() => {
      expect(app.dynamicRequests).toBe(requests);
      return Date.now() >= deadline;
    })
    .toBe(true);
  expect(workspace.store.get(session.session).events[0].revision).toBe(
    workspace.store.get(session.session).revision,
  );
  await expect(page.locator('#error')).toBeHidden();
});
