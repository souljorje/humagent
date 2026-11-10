import { test, expect } from './fixtures.ts';

test('a form draft survives a lost HTTP response and refills the form', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.loseResponse('drafts');
  const outcome = review.frame.locator('input[name="outcome"]');
  const saved = () => workspace.form(plan.session, 'launch')?.outcome;
  await outcome.fill('Survive the lost response');
  await outcome.blur();
  await expect.poll(saved).toBe('Survive the lost response');
  const documentId = () =>
    review.evaluate(() => window.__HUMAGENT__!.documentId);
  const before = await documentId();
  await Promise.all([
    page.waitForEvent(
      'framenavigated',
      (frame) => frame.parentFrame() === page.mainFrame(),
    ),
    review.evaluate(() => location.reload()),
  ]);
  await review.ready();
  await expect.poll(documentId, { timeout: 15000 }).not.toBe(before);
  await review.ready();
  await expect(outcome).toHaveValue('Survive the lost response');
  await outcome.fill('A later edit');
  await outcome.blur();
  await expect.poll(saved).toBe('A later edit');
  expect((await review.state()).drafts).toHaveLength(1);
});

test('a form keeps one draft that follows its current values', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const submit = review.frame.locator(
    'form[data-humagent-intent] button[type="submit"]',
  );
  const draft = page.locator('.draft');
  await submit.click();
  await submit.click();
  await expect(review.frame.locator('[data-humagent-status]')).toHaveText(
    'Added to review',
  );
  await expect(draft).toHaveCount(1);
  const outcome = review.frame.locator('input[name="outcome"]');
  await outcome.fill('A later form value.');
  await outcome.blur();
  await expect
    .poll(() => workspace.form(plan.session, 'launch')?.outcome)
    .toBe('A later form value.');
  await expect(draft).toHaveCount(1);
  await expect(draft.locator('dt').first()).toHaveText('approach');
  await expect(draft).toContainText('Working outcome');
  await expect(draft).toContainText('A later form value.');
  await expect(draft).toContainText('Keep a human confirmation step');
});

test('form values survive reload and Send delivers the current values', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const outcome = review.frame.locator('input[name="outcome"]');
  const notes = review.frame.locator('textarea[name="notes"]');
  const approach = review.frame.locator('input[value="platform-first"]');
  await approach.check();
  await outcome.fill('A preserved outcome.');
  await outcome.blur();
  await notes.fill('Exact note.');
  await notes.blur();
  await review.frame.locator('input[name="confirmBeforeAction"]').uncheck();
  await expect
    .poll(() => workspace.form(plan.session, 'launch')?.confirmBeforeAction)
    .toBe(false);
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  await page.reload();
  await review.ready();
  await expect(outcome).toHaveValue('A preserved outcome.');
  await expect(approach).toBeChecked();
  expect((await review.state()).drafts).toHaveLength(1);
  await review.connect();
  await page.locator('#send').click();
  expect((await review.events(1))[0].items[0].values).toMatchObject({
    approach: 'platform-first',
    outcome: 'A preserved outcome.',
    notes: 'Exact note.',
    confirmBeforeAction: false,
  });
  await expect(review.frame.locator('[data-humagent-status]')).toHaveText('');
});

test('deleting a form draft resets the form without adding it again', async ({
  page,
  plan: _plan,
  review,
}) => {
  const outcome = review.frame.locator('input[name="outcome"]');
  const original = await outcome.inputValue();
  await outcome.fill('Discard this value.');
  await outcome.blur();
  await expect(page.locator('.draft')).toHaveCount(1);
  await review.expand();
  await page.getByRole('button', { name: 'Delete feedback 1' }).click();
  await expect(page.locator('.draft')).toHaveCount(0);
  await expect(outcome).toHaveValue(original);
  await expect(review.frame.locator('[data-humagent-status]')).toHaveText('');
  // A reset must not schedule a save that recreates the draft.
  await page.waitForTimeout(500);
  expect((await review.state()).drafts).toHaveLength(0);
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
  expect((await review.draft()).values).toEqual({
    repeated: ['one', 'two'],
    checks: ['a'],
    radio: 'yes',
    multi: ['a', 'b'],
    adopted: 'another document',
  });
  expect(workspace.store.list()[0].events).toHaveLength(0);
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
