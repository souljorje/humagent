import fs from 'node:fs';
import { test, expect } from './fixtures.mjs';

test('saved form values survive a workspace reload', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.frame.locator('input[value="platform-first"]').check();
  await review.frame
    .locator('input[name="outcome"]')
    .fill('A preserved outcome.');
  await review.frame
    .locator('textarea[name="notes"]')
    .fill('Keep this exact note.');
  await review.frame.locator('input[name="confirmBeforeAction"]').uncheck();
  await expect
    .poll(() => workspace.store.get(plan.session).state.forms?.launch)
    .toMatchObject({
      approach: 'platform-first',
      outcome: 'A preserved outcome.',
      notes: 'Keep this exact note.',
      confirmBeforeAction: false,
    });

  await page.reload();
  await review.ready();
  await expect(review.frame.locator('input[name="outcome"]')).toHaveValue(
    'A preserved outcome.',
  );
  await expect(review.frame.locator('textarea[name="notes"]')).toHaveValue(
    'Keep this exact note.',
  );
  await expect(
    review.frame.locator('input[value="platform-first"]'),
  ).toBeChecked();
  await expect(
    review.frame.locator('input[name="confirmBeforeAction"]'),
  ).not.toBeChecked();
});

test('form submission reaches a waiting agent and displays its reply', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.frame.locator('input[value="platform-first"]').check();
  await review.frame
    .locator('input[name="outcome"]')
    .fill('A selected outcome.');
  await review.frame
    .locator('textarea[name="notes"]')
    .fill('Keep this exact note.');
  await review.frame.locator('input[name="confirmBeforeAction"]').uncheck();
  const waiting = workspace.api(`/api/sessions/${plan.session}/wait`, 'POST', {
    consumer: 'browser-test',
    timeoutMs: 10000,
  });
  await review.frame.locator('button[type="submit"]').click();
  const batch = await waiting;
  expect(batch.status).toBe('feedback');
  expect(batch.events).toHaveLength(1);
  expect(batch.events[0]).toMatchObject({
    kind: 'submission',
    payload: {
      values: {
        approach: 'platform-first',
        outcome: 'A selected outcome.',
        defer: 'automation',
        notes: 'Keep this exact note.',
        confirmBeforeAction: false,
      },
    },
  });

  await workspace.api(`/api/sessions/${plan.session}/reply`, 'POST', {
    receipt: batch.receipt,
    message: 'Updated the plan. Nothing was executed.',
  });
  await expect(page.locator('.entry.agent')).toHaveText(/Nothing was executed/);
  expect(workspace.store.get(plan.session).events[0].status).toBe('completed');
});

test('the SDK stores structured requests without a task handler', async ({
  plan,
  review,
  workspace,
}) => {
  const event = await review.evaluate(() =>
    window.humagent.submit({
      intent: 'a_new_task_without_a_handler',
      values: { ranks: ['b', 'a'], count: 7 },
    }),
  );
  expect(workspace.store.get(plan.session).events).toHaveLength(1);
  expect(event).toMatchObject({
    kind: 'submission',
    payload: {
      intent: 'a_new_task_without_a_handler',
      values: { ranks: ['b', 'a'], count: 7 },
    },
  });
});

for (const reload of [false, true]) {
  test(`form retries reuse accepted input after a lost response${reload ? ' and reload' : ''}`, async ({
    page,
    plan,
    review,
    workspace,
  }) => {
    const requests = [];
    await page.route(
      `**/api/sessions/${plan.session}/events`,
      async (route) => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          await route.abort();
        } else await route.continue();
      },
    );
    await review.frame.locator('button[type="submit"]').click();
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#outbox')).toBeVisible();
    expect(workspace.store.get(plan.session).events).toHaveLength(1);
    const original = workspace.store.get(plan.session).events[0];
    if (reload) {
      await page.reload();
      await review.ready();
    }
    await review.frame.locator('button[type="submit"]').click();
    await expect(review.frame.locator('[data-humagent-status]')).toHaveText(
      'Queued for the agent.',
    );
    await expect(page.locator('#outbox')).toBeHidden();
    expect(requests).toHaveLength(2);
    expect(requests[1].clientId).toBe(original.clientId);
    expect(workspace.store.get(plan.session).events).toHaveLength(1);

    // A confirmed submission does not suppress a later explicit request.
    await review.frame.locator('button[type="submit"]').click();
    await expect
      .poll(() => workspace.store.get(plan.session).events.length)
      .toBe(2);
    expect(workspace.store.get(plan.session).events[1].clientId).not.toBe(
      original.clientId,
    );
  });
}

test('SDK retries keep changed values and new revisions separate', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const routePattern = `**/api/sessions/${plan.session}/events`;
  await page.route(routePattern, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort();
  });
  const error = await review.evaluate(async () => {
    try {
      await window.humagent.submit({
        intent: 'review',
        values: { choice: 'original' },
      });
    } catch (error) {
      return error.message;
    }
  });
  expect(error).toBeTruthy();
  await expect(page.locator('#outbox')).toBeVisible();
  const original = workspace.store.get(plan.session).events[0];
  await page.unroute(routePattern);

  const changed = await review.evaluate(() =>
    window.humagent.submit({ intent: 'review', values: { choice: 'changed' } }),
  );
  expect(changed.id).not.toBe(original.id);
  await expect(page.locator('#outbox')).toBeVisible();

  fs.appendFileSync(workspace.file(), '<p>A new source revision.</p>');
  await page.reload();
  await review.ready();
  const revised = await review.evaluate(() =>
    window.humagent.submit({
      intent: 'review',
      values: { choice: 'original' },
    }),
  );
  expect(revised.id).not.toBe(original.id);
  expect(revised.revision).not.toBe(original.revision);
  expect(workspace.store.get(plan.session).events).toHaveLength(3);
  await expect(page.locator('#outbox')).toBeVisible();
  await page.locator('#retry').click();
  await expect(page.locator('#outbox')).toBeHidden();
  expect(workspace.store.get(plan.session).events).toHaveLength(3);
});

test('the SDK rejects lossy values before sending or saving them', async ({
  plan,
  review,
  workspace,
}) => {
  const rejected = await review.evaluate(async () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const values = [
      NaN,
      Infinity,
      undefined,
      () => {},
      Symbol('invalid'),
      1n,
      new Date(),
      cyclic,
      Array(1),
    ];
    let count = 0;
    for (const value of values) {
      try {
        await window.humagent.submit({ intent: 'invalid', values: { value } });
      } catch {
        count++;
      }
      try {
        await window.humagent.setState({ invalid: value });
      } catch {
        count++;
      }
    }
    return { count, expected: values.length * 2 };
  });
  expect(rejected.count).toBe(rejected.expected);
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  expect(workspace.store.get(plan.session).state).not.toHaveProperty('invalid');
});

test('custom state and form saves share one ordered update queue', async ({
  plan,
  review,
  workspace,
}) => {
  await review.frame
    .locator('textarea[name="notes"]')
    .fill('Keep this exact note.');
  await review.evaluate(async () => {
    const extra = document.createElement('form');
    extra.id = 'extra';
    extra.dataset.humagentIntent = 'extra';
    extra.dataset.humagentPersist = '';
    extra.innerHTML = '<input name="priority" value="high">';
    document.body.append(extra);
    const first = window.humagent.setState({ custom: { step: 1 } });
    extra.elements.priority.dispatchEvent(
      new Event('input', { bubbles: true }),
    );
    const second = window.humagent.setState({ another: 'kept' });
    await Promise.all([first, second]);
  });
  await expect
    .poll(() => workspace.store.get(plan.session).state)
    .toMatchObject({
      custom: { step: 1 },
      another: 'kept',
      forms: {
        launch: { notes: 'Keep this exact note.' },
        extra: { priority: 'high' },
      },
    });
});

test('a generated mini-app runs locally until submission', async ({
  review,
  workspace,
}) => {
  const session = await review.open(workspace.file('calculator.html'));
  await review.frame.locator('#tasks').evaluate((element) => {
    element.value = '120';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(review.frame.locator('#hours')).toHaveText('16.0 hours');
  expect(workspace.store.get(session.session).events).toHaveLength(0);
  await review.frame.locator('button[type="submit"]').click();
  await expect
    .poll(() => workspace.store.get(session.session).events.length)
    .toBe(1);
});
