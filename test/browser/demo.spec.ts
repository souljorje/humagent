import fs from 'node:fs';
import { test, expect } from './fixtures.ts';

test('the demo fits desktop and mobile, retains keyboard focus, and preserves text layout while editing', async ({
  page,
  review,
  workspace,
}) => {
  await review.open(workspace.file('plan.html'));
  await review.expand(false);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await review.evaluate(() => scrollTo(0, 0));
    await expect(
      review.frame.getByRole('heading', {
        name: 'Show your agent what you mean',
      }),
    ).toBeVisible();
    expect(
      await review.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const option = review.frame.getByRole('radio', { name: 'Stacked' });
    await option.focus();
    await expect(option).toBeFocused();
    await expect(option).toHaveCSS('outline-style', 'solid');
  }
  await review.annotate();
  for (const selector of [
    'h1',
    '.steps h3',
    '.steps p',
    '.note',
    '.mock-hero h3',
    '.mock-hero p',
    '.choice',
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
    await target.click({ position: { x: before.clickX, y: before.clickY } });
    await expect(review.editor).toBeFocused();
    const after = await glyph();
    expect(after.x, selector).toBeCloseTo(before.x, 1);
    expect(after.y, selector).toBeCloseTo(before.y, 1);
    await review.editor.press('Escape');
    expect(await target.textContent()).toBe(original);
  }
});

test('the demo combines text edits, comments, and choices without changing source', async ({
  page,
  review,
  workspace,
}) => {
  const file = workspace.file('plan.html');
  const source = fs.readFileSync(file, 'utf8');
  const opened = await review.open(file);
  await review.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          document.body.dataset.copied = value;
        },
      },
    }),
  );
  const copyButton = review.frame.getByRole('button', {
    name: 'Copy npx skills add souljorje/humagent',
  });
  await copyButton.click();
  await expect(copyButton).toHaveAttribute('data-copied', '');
  expect(await review.evaluate(() => document.body.dataset.copied)).toBe(
    'npx skills add souljorje/humagent',
  );
  await review.expand(false);
  const headline = await review.frame.locator('h1').textContent();
  await review.replace('h1', 'Give your agent a clearer plan.');
  await review.addComment('.mock-cta', 'Make this button stand out.');
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const choice = review.frame.getByRole('radio', { name: /The interactions/ });
  const button = review.frame.getByRole('radio', { name: 'Outline' });
  await choice.check();
  await review.frame.getByRole('radio', { name: 'Split' }).check();
  await button.check();
  // Choices save at once, into one draft for the form.
  const values = { layout: 'split', button: 'outline', workflow: 'behavior' };
  await expect
    .poll(() => workspace.form(opened.session, 'design-choices'))
    .toEqual(values);
  expect((await review.state()).drafts).toHaveLength(3);
  expect(workspace.store.get(opened.session).events).toHaveLength(0);
  expect(fs.readFileSync(file, 'utf8')).toBe(source);
  await page.reload();
  await review.ready();
  await expect(choice).toBeChecked();
  await expect(button).toBeChecked();
  await review.connect();
  await page.locator('#send').click();
  const feedback = await review.receive();
  expect(feedback.events).toHaveLength(1);
  expect(feedback.events[0].items).toHaveLength(3);
  expect(feedback.events[0].items[1].comment).toBe(
    'Make this button stand out.',
  );
  expect(feedback.events[0].items[2]).toMatchObject({
    comment:
      'Apply these choices to the first screen. Do not publish anything.',
    values,
  });
  expect(Object.keys(feedback.events[0].items[2]!)).toEqual([
    'id',
    'comment',
    'values',
  ]);
  const heading = review.frame.locator('h1');
  await expect(heading).toHaveText('Give your agent a clearer plan.');
  await workspace.api(`/api/sessions/${opened.session}/ack`, 'POST', {
    receipt: feedback.receipt,
  });
  await expect(heading).toHaveText(headline!);
  expect(fs.readFileSync(file, 'utf8')).toBe(source);
});
