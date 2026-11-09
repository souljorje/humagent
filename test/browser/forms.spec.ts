import { test, expect, type Feedback } from './fixtures.ts';

test('form persistence survives a lost HTTP response', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  let dropped = false;
  await page.route(`**/api/sessions/${plan.session}/forms/*`, async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await review.frame
    .locator('input[name="outcome"]')
    .fill('Survive the lost response');
  await expect
    .poll(() => workspace.forms(plan.session).launch?.outcome)
    .toBe('Survive the lost response');
  const documentId = await review.evaluate(
    () => window.__HUMAGENT__!.documentId,
  );
  await Promise.all([
    page.waitForEvent(
      'framenavigated',
      (frame) => frame.parentFrame() === page.mainFrame(),
    ),
    review.evaluate(() => location.reload()),
  ]);
  await review.ready();
  await expect
    .poll(() => review.evaluate(() => window.__HUMAGENT__!.documentId), {
      timeout: 15000,
    })
    .not.toBe(documentId);
  await review.ready();
  await expect(review.frame.locator('input[name="outcome"]')).toHaveValue(
    'Survive the lost response',
  );
  await review.frame.locator('input[name="outcome"]').fill('A later edit');
  await expect
    .poll(() => workspace.forms(plan.session).launch?.outcome)
    .toBe('A later edit');
});

test('form submission captures values before delayed persistence', async ({
  page,
  plan,
  review,
}) => {
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(`**/api/sessions/${plan.session}/forms/*`, async (route) => {
    if (++requests === 1) await delayed;
    await route.continue();
  });
  await review.frame.locator('input[name="outcome"]').fill('Submitted value');
  await review.frame
    .locator('form[data-humagent-intent] button[type="submit"]')
    .click();
  await expect.poll(() => requests).toBe(1);
  await review.frame.locator('input[name="outcome"]').fill('Later value');
  release();
  await expect(page.locator('.draft')).toHaveCount(1);
  expect((await review.state()).drafts[0].item.values!.outcome).toBe(
    'Submitted value',
  );
});

test('form values survive reload and staged values remain a separate snapshot', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.frame.locator('input[value="platform-first"]').check();
  await review.frame
    .locator('input[name="outcome"]')
    .fill('A preserved outcome.');
  await review.frame.locator('textarea[name="notes"]').fill('Exact note.');
  await review.frame.locator('input[name="confirmBeforeAction"]').uncheck();
  await review.frame
    .locator('form[data-humagent-intent] button[type="submit"]')
    .click();
  await expect(review.frame.locator('[data-humagent-status]')).toHaveText(
    'Added to review',
  );
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  await review.frame
    .locator('input[name="outcome"]')
    .fill('A later form value.');
  await expect
    .poll(() => workspace.forms(plan.session).launch?.outcome)
    .toBe('A later form value.');
  await page.reload();
  await review.ready();
  await expect(review.frame.locator('input[name="outcome"]')).toHaveValue(
    'A later form value.',
  );
  await expect(
    review.frame.locator('input[value="platform-first"]'),
  ).toBeChecked();
  expect((await review.state()).drafts[0].item.values!.outcome).toBe(
    'A preserved outcome.',
  );
  await review.connect();
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(plan.session).events.length)
    .toBe(1);
  expect(
    workspace.store.get(plan.session).events[0].items[0].values,
  ).toMatchObject({
    approach: 'platform-first',
    notes: 'Exact note.',
    confirmBeforeAction: false,
  });
});

test('SDK and forms stage beside annotations and one batch reaches the waiting agent', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const result = await review.evaluate(() =>
    window.humagent.submit({
      intent: 'a_new_task',
      values: { ranks: ['b', 'a'] },
      message: 'Use these choices.',
    }),
  );
  expect(result).toMatchObject({
    status: 'draft',
    draftId: expect.any(String),
  });
  expect(await review.evaluate(() => Object.keys(window.humagent))).toEqual([
    'submit',
  ]);
  await review.frame
    .locator('form[data-humagent-intent] button[type="submit"]')
    .click();
  await expect(page.locator('.draft')).toHaveCount(2);
  await review.addComment('h1', 'Keep it short.');
  await page.locator('#message').fill('Review everything together.');
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  const waiting = workspace.api<Feedback>(
    `/api/sessions/${plan.session}/wait`,
    'POST',
    {
      consumer: 'test',
      timeoutMs: 10000,
    },
  );
  await review.connect();
  await page.locator('#send').click();
  const receipt = await waiting;
  expect(receipt.events).toHaveLength(1);
  expect(receipt.events[0].items).toHaveLength(3);
  expect(receipt.events[0].message).toBe('Review everything together.');
  await workspace.api(`/api/sessions/${plan.session}/ack`, 'POST', {
    receipt: receipt.receipt,
  });
  await expect(page.locator('#agent-state')).toHaveText('No agent waiting');
  expect(workspace.store.get(plan.session).events[0].status).toBe('completed');
});

test('SDK rejects lossy values and failed server writes without staging success', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const count = await review.evaluate(async () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    let rejected = 0;
    for (const value of [
      NaN,
      Infinity,
      undefined,
      () => {},
      Symbol('x'),
      1n,
      new Date(),
      cyclic,
      Array(1),
    ]) {
      try {
        // Exercise runtime rejection of values excluded by the SDK's TypeScript contract.
        // @ts-expect-error Deliberately invalid JSON values.
        await window.humagent.submit({ intent: 'invalid', values: { value } });
      } catch {
        rejected++;
      }
    }
    return rejected;
  });
  expect(count).toBe(9);
  const drafts = `**/api/sessions/${plan.session}/drafts`;
  await page.route(drafts, (route) =>
    route.fulfill({
      status: 500,
      json: { error: 'ERROR', message: 'Storage full' },
    }),
  );
  const failure = await review.evaluate(async () => {
    try {
      await window.humagent.submit({
        intent: 'review',
        values: { safe: true },
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  expect(failure).toContain('Storage full');
  expect((await review.state()).drafts).toHaveLength(0);
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  await page.unroute(drafts);
  await review.evaluate(() =>
    window.humagent.submit({ intent: 'review', values: { safe: true } }),
  );
  await expect(page.locator('.draft')).toHaveCount(1);
});

test('form serialization handles repeated fields and excludes private or disabled fields', async ({
  page,
  review,
  workspace,
}) => {
  await review.open();
  await review.expand(false);
  await review.evaluate(() => {
    const form = document.createElement('form');
    form.dataset.humagentIntent = 'controls';
    form.innerHTML =
      '<input name="repeated" value="one"><input name="repeated" value="two"><input type="checkbox" name="checks" value="a" checked><input type="checkbox" name="checks" value="b"><input type="radio" name="radio" value="yes" checked><select name="multi" multiple><option selected>a</option><option selected>b</option></select><input type="password" name="secret" value="no"><input type="file" name="file"><input name="disabled" disabled><button>Stage controls</button>';
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const adopted = frame.contentDocument!.createElement('input');
    adopted.name = 'adopted';
    adopted.value = 'another document';
    form.append(document.adoptNode(adopted));
    frame.remove();
    document.body.append(form);
  });
  await review.frame.getByRole('button', { name: 'Stage controls' }).click();
  await expect(page.locator('.draft')).toHaveCount(1);
  expect((await review.state()).drafts[0].item.values).toEqual({
    repeated: ['one', 'two'],
    checks: ['a'],
    radio: 'yes',
    multi: ['a', 'b'],
    adopted: 'another document',
  });
  expect(workspace.store.list()[0].events).toHaveLength(0);
});

test('generated mini-app stays local until Send', async ({
  page,
  review,
  workspace,
}) => {
  const opened = await review.open(workspace.file('plan.html'));
  await review.frame.locator('input[value="prototype"]').check();
  await review.frame
    .locator('input[name="outcome"]')
    .fill('A focused prototype.');
  expect(workspace.store.get(opened.session).events).toHaveLength(0);
  await review.frame
    .locator('form[data-humagent-intent] button[type="submit"]')
    .click();
  await expect(page.locator('.draft')).toHaveCount(1);
  expect((await review.state()).drafts[0].item.values).toMatchObject({
    workflow: 'prototype',
    outcome: 'A focused prototype.',
  });
  expect(workspace.store.get(opened.session).events).toHaveLength(0);
  await review.connect();
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(opened.session).events.length)
    .toBe(1);
});

test('separate concurrent SDK calls with equal values stage separate drafts', async ({
  review,
}) => {
  await review.open();
  const results = await review.evaluate(() =>
    Promise.all([
      window.humagent.submit({ intent: 'repeat', values: { choice: 'A' } }),
      window.humagent.submit({ intent: 'repeat', values: { choice: 'A' } }),
    ]),
  );
  expect(results[0]!.draftId).not.toBe(results[1]!.draftId);
  const drafts = (await review.state()).drafts;
  expect(drafts.filter((d) => d.item.intent === 'repeat')).toHaveLength(2);
});
