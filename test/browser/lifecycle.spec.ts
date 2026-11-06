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
    await expect(page.locator('#send')).toBeEnabled();
    await page.locator('#send').click();
    await expect
      .poll(() => workspace.store.get(opened.session).events.length)
      .toBe(1);
    expect(workspace.store.get(opened.session).surfacePath).toBe('/b');
  } finally {
    release();
  }
});

test('navigation stays current when a corrective request also arrives late', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const opened = await review.open(app.origin + '/a');
  let releaseA!: () => void, releaseB!: () => void, secondDocument: string;
  const waitA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const waitB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  let heldA = false,
    heldB = false,
    appliedB = false;
  await page.route(
    `**/api/sessions/${opened.session}/surface`,
    async (route) => {
      if (!heldA) {
        const response = await route.fetch();
        heldA = true;
        await waitA;
        return route.fulfill({ response });
      }
      if (
        !heldB &&
        route.request().postDataJSON().documentId === secondDocument
      ) {
        heldB = true;
        await waitB;
        const response = await route.fetch();
        appliedB = true;
        return route.fulfill({ response });
      }
      await route.continue();
    },
  );
  try {
    if (
      (await page.locator('#toggle-review').getAttribute('aria-expanded')) !==
      'true'
    )
      await page.locator('#toggle-review').click();
    await review.evaluate(() => location.reload());
    await expect.poll(() => heldA).toBe(true);
    await review.evaluate(() => {
      location.href = '/b';
    });
    await expect(review.frame.locator('h1')).toHaveText('Page b');
    await review.ready();
    secondDocument = await review.evaluate(
      () => window.__HUMAGENT__!.documentId,
    );
    releaseA();
    await expect.poll(() => heldB).toBe(true);
    await review.evaluate(() => {
      location.href = '/c';
    });
    await expect(review.frame.locator('h1')).toHaveText('Page c');
    await review.ready();
    await review.evaluate(() =>
      window.humagent.submit({ intent: 'current', values: { page: 'c' } }),
    );
    releaseB();
    await expect.poll(() => appliedB).toBe(true);
    await expect
      .poll(() => workspace.store.get(opened.session).surfacePath)
      .toBe('/c');
    await expect(page.locator('#send')).toBeEnabled();
    await page.locator('#send').click();
    await expect
      .poll(() => workspace.store.get(opened.session).events.length)
      .toBe(1);
  } finally {
    releaseA();
    releaseB();
  }
});

test('late navigation responses cannot replace the current revision', async ({
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
  await page.route(
    `**/api/sessions/${opened.session}/surface`,
    async (route) => {
      if (held) return route.continue();
      const response = await route.fetch();
      held = true;
      await delayed;
      await route.fulfill({ response });
      finished = true;
    },
  );
  try {
    if (
      (await page.locator('#toggle-review').getAttribute('aria-expanded')) !==
      'true'
    )
      await page.locator('#toggle-review').click();
    await review.evaluate(() => location.reload());
    await expect.poll(() => held).toBe(true);
    await review.evaluate(() => {
      location.href = '/b';
    });
    await expect(review.frame.locator('h1')).toHaveText('Page b');
    await review.ready();
    await review.evaluate(() =>
      window.humagent.submit({ intent: 'current', values: { page: 'b' } }),
    );
    await expect(page.locator('#send')).toBeEnabled();
    release();
    await expect.poll(() => finished).toBe(true);
    await page.locator('#send').click();
    await expect
      .poll(() => workspace.store.get(opened.session).events.length)
      .toBe(1);
    expect(workspace.store.get(opened.session).surfacePath).toBe('/b');
    await expect(page.locator('#error')).toBeHidden();
  } finally {
    release();
  }
});

test('nested app frames preserve the attached document and keep their native forms', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const opened = await review.open(app.origin + '/a');
  const before = workspace.store.get(opened.session);
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
  expect(workspace.store.get(opened.session).surfacePath).toBe('/a');
  await review.addComment('h1', 'Review the parent');
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(opened.session).events.length)
    .toBe(1);
  expect(workspace.store.get(opened.session).events[0].revision).toBe(
    before.revision,
  );
});

test('default restarts retain drafts, form values, and pending input', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.frame
    .locator('input[name="outcome"]')
    .fill('A preserved outcome.');
  await expect
    .poll(() => workspace.forms(plan.session).launch?.outcome)
    .toBe('A preserved outcome.');
  const blockedEvents = `**/api/sessions/${plan.session}/events`;
  await page.route(blockedEvents, (route) => route.abort());
  await page.locator('#toggle-review').click();
  await page.locator('#message').fill('Keep this unsent message.');
  await page.locator('#send').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#outbox')).toBeVisible();
  const pendingId = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem(`humagent:review:${id}`)!).outbox[0].batch
        .clientId,
    plan.session,
  );
  await page.unroute(blockedEvents);

  const origin = workspace.origin;
  await workspace.restart();
  expect(workspace.origin).toBe(origin);
  await expect(page.locator('#error')).toContainText('service restarted');
  const reconnected = await workspace.api(`/api/sessions/${plan.session}`);
  await page.reload();
  await review.ready();
  await expect
    .poll(() => review.evaluate(() => location.origin))
    .toBe(reconnected.surface.origin);
  await expect(review.frame.locator('input[name="outcome"]')).toHaveValue(
    'A preserved outcome.',
  );

  const resumed = await review.open();
  expect(resumed.session).toBe(plan.session);
  await expect(page.locator('#message')).toHaveValue(
    'Keep this unsent message.',
  );
  await expect(page.locator('#outbox')).toBeVisible();
  const restoredId = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem(`humagent:review:${id}`)!).outbox[0].batch
        .clientId,
    plan.session,
  );
  expect(restoredId).toBe(pendingId);
  await page.getByRole('button', { name: 'Retry send', exact: true }).click();
  await expect
    .poll(
      () =>
        workspace.store
          .get(plan.session)
          .events.filter((event) => event.clientId === pendingId).length,
    )
    .toBe(1);
  await expect(page.locator('#outbox')).toBeHidden();
});

test('existing apps retain native clicks, API requests, and annotations', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const session = await review.open(app.origin + '/nested');
  await review.frame.locator('#counter').click();
  await expect(review.frame.locator('#counter')).toHaveText('Count: 1');
  expect(
    await review.evaluate(async () => (await fetch('/api/value')).json()),
  ).toEqual({ value: 42 });
  await review.addComment('#headline', 'Review an existing app.');
  await page.locator('#send').click();
  await expect
    .poll(
      () =>
        workspace.store.get(session.session).events[0]?.payload.items[0].target!
          .id,
    )
    .toBe('headline');
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
  await review.frame.locator('input[name="note"]').fill('Save before reload.');
  expect(
    await review.evaluate(
      () =>
        !window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ),
  ).toBe(true);
  await expect
    .poll(() => workspace.forms(session.session).route?.note)
    .toBe('Save before reload.');
  if (
    (await page.locator('#toggle-review').getAttribute('aria-expanded')) !==
    'true'
  )
    await page.locator('#toggle-review').click();
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
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(opened.session).events.length)
    .toBe(1);
  expect(workspace.store.get(opened.session).events).toHaveLength(1);
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
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(session.session).events.length)
    .toBe(1);
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
