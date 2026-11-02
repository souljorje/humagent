import { test, expect } from './fixtures.mjs';

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
    .poll(() => workspace.store.get(plan.session).state.forms?.launch?.outcome)
    .toBe('A preserved outcome.');
  const blockedEvents = `**/api/sessions/${plan.session}/events`;
  await page.route(blockedEvents, (route) => route.abort());
  await page.locator('#message').fill('Keep this unsent message.');
  await page.locator('#send').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#outbox')).toBeVisible();
  const pendingId = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem(`humagent:outbox:${id}`))[0].clientId,
    plan.session,
  );
  await page.unroute(blockedEvents);

  const origin = workspace.origin;
  await workspace.restart();
  expect(workspace.origin).toBe(origin);
  await expect(page.locator('#error')).toContainText('service restarted');
  const reconnected = await workspace.api(`/api/sessions/${plan.session}`);
  await page.locator('#refresh').click();
  await expect
    .poll(() => review.evaluate(() => location.origin))
    .toBe(reconnected.surface.origin);
  await review.ready();
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
      JSON.parse(localStorage.getItem(`humagent:outbox:${id}`))[0].clientId,
    plan.session,
  );
  expect(restoredId).toBe(pendingId);
  await page.locator('#retry').click();
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
  await page.locator('[data-mode="annotate"]').click();
  await review.frame.locator('#headline').click();
  await page.locator('#message').fill('Review an existing app.');
  await page.locator('#send').click();
  await expect
    .poll(
      () => workspace.store.get(session.session).events[0]?.payload.target.id,
    )
    .toBe('headline');
});

test('refresh flushes state and keeps the currently displayed route', async ({
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
  await page.locator('#refresh').click();
  await review.ready();
  expect(await review.evaluate(() => location.pathname)).toBe('/b');
  await expect(review.frame.locator('h1')).toHaveText('Page b');
  await expect(review.frame.locator('input[name="note"]')).toHaveValue(
    'Save before reload.',
  );
  expect(workspace.store.get(session.session).surfacePath).toBe('/b');
});

test('dynamic HTML accepts submissions without a refresh loop', async ({
  page,
  review,
  workspace,
  app,
}) => {
  const session = await review.open(app.origin + '/dynamic');
  const requests = app.dynamicRequests;
  await review.frame.locator('button[type="submit"]').click();
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
