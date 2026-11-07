import fs from 'node:fs';
import { test, expect } from './fixtures.ts';

test('the plan demo combines text edits, comments, and choices without changing source', async ({
  page,
  review,
  workspace,
}) => {
  const file = workspace.file('plan.html');
  const source = fs.readFileSync(file, 'utf8');
  const opened = await review.open(file);
  await review.expand(false);
  const headline = await review.frame.locator('h1').textContent();
  await review.replace('h1', 'Give your agent a clearer plan.');
  await review.addComment('#plan-title', 'Keep this focused.');
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await review.frame
    .getByRole('radio', { name: /Explore a prototype/ })
    .check();
  await review.frame
    .getByLabel('What would a good result look like?')
    .fill('An easier first review.');
  await review.frame
    .getByLabel('Where should the agent focus?')
    .selectOption('behavior');
  await review.frame
    .getByLabel('Anything to preserve?')
    .fill('Keep existing interactions.');
  await review.frame
    .getByRole('button', { name: 'Add plan to feedback' })
    .click();
  await expect.poll(async () => (await review.state()).drafts.length).toBe(3);
  expect(workspace.store.get(opened.session).events).toHaveLength(0);
  expect(fs.readFileSync(file, 'utf8')).toBe(source);
  await page.reload();
  await review.ready();
  await expect(
    review.frame.getByRole('radio', { name: /Explore a prototype/ }),
  ).toBeChecked();
  await expect(review.frame.getByLabel('Anything to preserve?')).toHaveValue(
    'Keep existing interactions.',
  );
  await review.connect();
  await page.locator('#send').click();
  const feedback = await review.receive();
  expect(feedback.events).toHaveLength(1);
  expect(feedback.events[0].payload.items).toHaveLength(3);
  expect(feedback.events[0].payload.items[2]).toMatchObject({
    intent: 'plan_review',
    values: {
      workflow: 'prototype',
      outcome: 'An easier first review.',
      focus: 'behavior',
      notes: 'Keep existing interactions.',
      preserveBehavior: true,
    },
  });
  await expect(review.frame.locator('h1')).toHaveText(
    'Give your agent a clearer plan.',
  );
  await workspace.api(`/api/sessions/${opened.session}/ack`, 'POST', {
    receipt: feedback.receipt,
  });
  await expect(review.frame.locator('h1')).toHaveText(headline!);
  expect(fs.readFileSync(file, 'utf8')).toBe(source);
});

for (const width of [1440, 390])
  test(`the plan guide fits ${width}px and retains keyboard focus`, async ({
    page,
    review,
    workspace,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await review.open(workspace.file('plan.html'));
    await review.expand(false);
    await page
      .locator('#toggle-review')
      .evaluate((el) => (el as HTMLElement).blur());
    await page.mouse.move(0, 0);
    await expect(
      review.frame.getByRole('heading', {
        name: 'Show your agent what you mean.',
      }),
    ).toBeVisible();
    expect(
      await review.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`plan-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await review.frame.locator('.page-footer').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath(`plan-${width}-guide.png`),
      animations: 'disabled',
    });
    const outcome = review.frame.getByLabel(
      'What would a good result look like?',
    );
    await outcome.focus();
    await expect(outcome).toBeFocused();
    expect(
      await outcome.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).toBe('solid');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const submit = review.frame.getByRole('button', {
      name: 'Add plan to feedback',
    });
    await expect(submit).toHaveCSS('transition-duration', '0s');
  });
