import fs from 'node:fs';
import { test, expect } from './fixtures.ts';

for (const width of [1440, 390])
  test(`editing demo text preserves its layout at ${width}px`, async ({
    page,
    review,
    workspace,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await review.open(workspace.file('plan.html'));
    await review.expand(false);
    await page.locator('#annotate').click();
    for (const selector of [
      'h1',
      '.intro p',
      '.plan-heading p',
      '.choice-title',
      '.field',
      '.preserve',
      '.plan-status p',
      '.loop h3',
      '.loop p',
      '.checklist li',
    ]) {
      const target = review.frame.locator(selector).first();
      await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const original = await target.textContent();
      const glyph = () =>
        target.evaluate((el) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            const offset = node.data.search(/\S/);
            if (offset < 0) continue;
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            const parent = el.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              clickX: rect.x - parent.x + 2,
              clickY: rect.y - parent.y + rect.height / 2,
            };
          }
          throw new Error('Missing visible text');
        });
      const before = await glyph();
      await target.click({
        position: { x: before.clickX, y: before.clickY },
      });
      const editor = review.frame.getByRole('textbox', {
        name: 'Edit text',
        exact: true,
      });
      await expect(editor).toBeFocused();
      const after = await glyph();
      expect(after.x, selector).toBeCloseTo(before.x, 1);
      expect(after.y, selector).toBeCloseTo(before.y, 1);
      if (selector === '.loop p')
        await page.screenshot({
          path: test.info().outputPath(`loop-edit-${width}.png`),
          animations: 'disabled',
        });
      await editor.press('Escape');
      expect(await target.textContent()).toBe(original);
    }
  });

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
  await review.frame.getByRole('radio', { name: /The interactions/ }).check();
  await review.frame
    .getByLabel('What would a good result look like?')
    .fill('An easier first review.');
  await review.frame
    .getByLabel('How much should change per pass?')
    .selectOption('behavior');
  await review.frame
    .getByLabel('Anything to leave alone?')
    .fill('Keep existing interactions.');
  await expect
    .poll(() => workspace.form(opened.session, 'review-plan')?.notes)
    .toBe('Keep existing interactions.');
  await expect(review.frame.locator('[data-humagent-status]')).toHaveText(
    'Added to review',
  );
  expect((await review.state()).drafts).toHaveLength(3);
  expect(workspace.store.get(opened.session).events).toHaveLength(0);
  expect(fs.readFileSync(file, 'utf8')).toBe(source);
  await page.reload();
  await review.ready();
  await expect(
    review.frame.getByRole('radio', { name: /The interactions/ }),
  ).toBeChecked();
  await expect(review.frame.getByLabel('Anything to leave alone?')).toHaveValue(
    'Keep existing interactions.',
  );
  await review.connect();
  await page.locator('#send').click();
  const feedback = await review.receive();
  expect(feedback.events).toHaveLength(1);
  expect(feedback.events[0].items).toHaveLength(3);
  expect(feedback.events[0].items[2]).toMatchObject({
    intent: 'plan_review',
    values: {
      workflow: 'behavior',
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
  test(`the plan page fits ${width}px and retains keyboard focus`, async ({
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
    await review.frame.locator('.receive pre').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath(`plan-${width}-bottom.png`),
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
    await expect(review.frame.locator('.choice').first()).toHaveCSS(
      'transition-duration',
      '0s',
    );
  });
