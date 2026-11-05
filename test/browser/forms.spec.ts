import { test, expect, type Feedback } from './fixtures.ts';

for (const lost of ['HTTP response', 'bridge acknowledgment'])
  test(`form persistence recovers a lost ${lost}`, async ({
    page,
    plan,
    review,
    workspace,
  }) => {
    if (lost === 'HTTP response') {
      let dropped = false;
      await page.route(
        `**/api/sessions/${plan.session}/state`,
        async (route) => {
          if (!dropped) {
            dropped = true;
            await route.fetch();
            await route.abort();
          } else await route.continue();
        },
      );
    } else {
      await page.addInitScript(() => {
        let dropped = false;
        window.addEventListener(
          'message',
          (event) => {
            if (
              !dropped &&
              event.data?.method === 'result' &&
              event.data.result?.stateVersion === 1
            ) {
              dropped = true;
              window.droppedStateAcknowledgment = true;
              event.stopImmediatePropagation();
            }
          },
          true,
        );
      });
      await page.reload();
      await review.ready();
    }
    await review.frame
      .locator('input[name="outcome"]')
      .fill('Survive the lost response');
    await expect
      .poll(() => workspace.forms(plan.session).launch?.outcome)
      .toBe('Survive the lost response');
    if (lost === 'bridge acknowledgment')
      await expect
        .poll(() => review.evaluate(() => window.droppedStateAcknowledgment))
        .toBe(true);
    const documentId = await review.evaluate(
      () => window.__HUMAGENT__!.documentId,
    );
    await page.locator('#refresh').click();
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
  await page.route(`**/api/sessions/${plan.session}/state`, async (route) => {
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
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(plan.session).events.length)
    .toBe(1);
  expect(
    workspace.store.get(plan.session).events[0].payload.items[0].values,
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
  await page.locator('#send').click();
  const receipt = await waiting;
  expect(receipt.events).toHaveLength(1);
  expect(receipt.events[0].payload.items).toHaveLength(3);
  expect(receipt.events[0].payload.message).toBe('Review everything together.');
  await workspace.api(`/api/sessions/${plan.session}/reply`, 'POST', {
    receipt: receipt.receipt,
    message: 'Updated. Nothing was executed.',
  });
  await expect(page.locator('#activity')).toContainText(
    'Nothing was executed.',
  );
  expect(workspace.store.get(plan.session).events[0].status).toBe('completed');
});

for (const reload of [false, true])
  test(`a lost HTTP response retries the same batch${reload ? ' after reload' : ''}`, async ({
    page,
    plan,
    review,
    workspace,
  }) => {
    const requests: unknown[] = [];
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
    await review.evaluate(() =>
      window.humagent.submit({
        intent: 'review',
        values: { decision: 'first' },
      }),
    );
    await page.locator('#send').click();
    await expect(page.locator('#outbox')).toBeVisible();
    await expect(page.locator('#error')).toBeVisible();
    expect(workspace.store.get(plan.session).events).toHaveLength(1);
    if (reload) {
      await page.reload();
      await review.ready();
    }
    await review.evaluate(() =>
      window.humagent.submit({ intent: 'review', values: { decision: 'new' } }),
    );
    await page.locator('#message').fill('A new instruction');
    await page
      .getByRole('button', { name: 'Retry batch', exact: true })
      .click();
    await expect(page.locator('#outbox')).toBeHidden();
    expect(requests[1]).toEqual(requests[0]);
    expect(workspace.store.get(plan.session).events).toHaveLength(1);
    expect((await review.state()).drafts[0].item.values!.decision).toBe('new');
    await expect(page.locator('#message')).toHaveValue('A new instruction');
    await page.locator('#send').click();
    await expect
      .poll(() => workspace.store.get(plan.session).events.length)
      .toBe(2);
  });

test('SDK rejects lossy values and failed browser persistence without staging success', async ({
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
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('humagent:review:')) throw new Error('Storage full');
      return window.originalSetItem.call(this, key, value);
    };
  });
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
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalSetItem;
  });
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
  await review.evaluate(() => {
    const form = document.createElement('form');
    form.dataset.humagentIntent = 'controls';
    form.innerHTML =
      '<input name="repeated" value="one"><input name="repeated" value="two"><input type="checkbox" name="checks" value="a" checked><input type="checkbox" name="checks" value="b"><input type="radio" name="radio" value="yes" checked><select name="multi" multiple><option selected>a</option><option selected>b</option></select><input type="password" name="secret" value="no"><input type="file" name="file"><input name="disabled" disabled><button>Stage controls</button>';
    document.body.append(form);
  });
  await review.frame.getByRole('button', { name: 'Stage controls' }).click();
  await expect(page.locator('.draft')).toHaveCount(1);
  expect((await review.state()).drafts[0].item.values).toEqual({
    repeated: ['one', 'two'],
    checks: ['a'],
    radio: 'yes',
    multi: ['a', 'b'],
  });
  expect(workspace.store.list()[0].events).toHaveLength(0);
});

test('generated mini-app stays local until Send all', async ({
  page,
  review,
  workspace,
}) => {
  const opened = await review.open(workspace.file('calculator.html'));
  await review.frame.locator('#tasks').evaluate((el) => {
    (el as HTMLInputElement).value = '120';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(review.frame.locator('#hours')).toHaveText('16.0 hours');
  await review.frame
    .locator('form[data-humagent-intent] button[type="submit"]')
    .click();
  await expect(page.locator('.draft')).toHaveCount(1);
  expect(workspace.store.get(opened.session).events).toHaveLength(0);
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(opened.session).events.length)
    .toBe(1);
});

test('an accepted batch can be confirmed after the session ends', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const pattern = `**/api/sessions/${plan.session}/events`;
  await page.route(pattern, async (route) => {
    await route.fetch();
    await route.abort();
  });
  await review.evaluate(() =>
    window.humagent.submit({ intent: 'review', values: { chosen: true } }),
  );
  await page.locator('#send').click();
  await expect(page.locator('#error')).toBeVisible();
  await page.unroute(pattern);
  await workspace.api(`/api/sessions/${plan.session}/end`, 'POST', {});
  await expect(page.locator('#presence')).toHaveText('Ended');
  await page.getByRole('button', { name: 'Retry batch' }).click();
  await expect(page.locator('#outbox')).toBeHidden();
  expect(workspace.store.get(plan.session).events).toHaveLength(1);
});

test('lost staging acknowledgments retry without duplicate drafts', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.addInitScript(() => {
    let dropped = false;
    window.addEventListener(
      'message',
      (event) => {
        if (
          !dropped &&
          event.data?.method === 'result' &&
          event.data.result?.status === 'draft'
        ) {
          dropped = true;
          window.droppedStageAcknowledgment = true;
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  });
  await page.reload();
  await review.ready();
  const staged = await review.evaluate(() =>
    window.humagent.submit({ intent: 'review', values: { chosen: true } }),
  );
  expect(staged.status).toBe('draft');
  expect(await review.evaluate(() => window.droppedStageAcknowledgment)).toBe(
    true,
  );
  expect((await review.state()).drafts).toHaveLength(1);
  await expect(page.locator('.draft')).toHaveCount(1);
});
