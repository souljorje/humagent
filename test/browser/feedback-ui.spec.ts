import { test, expect } from './fixtures.ts';

test('indented source text stays readable in the inline diff', async ({
  page,
  review,
  workspace,
}) => {
  await review.open(workspace.file('plan.html'));
  const before = (await review.frame.locator('.page-footer p').textContent())!;
  expect(before).toMatch(/\n\s+/);
  await review.replace('.page-footer p', '');
  await review.expand();
  const diff = page.locator('.replacement');
  await expect(diff.locator('del')).toHaveText(before);
  expect((await review.state()).drafts[0].item.replacement).toEqual({
    before,
    after: '',
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(diff).toHaveCSS('white-space', 'normal');
    expect(
      await diff.evaluate(
        (el) =>
          el.scrollHeight <= el.clientHeight &&
          el.scrollWidth <= el.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`indented-diff-${width}.png`),
      animations: 'disabled',
    });
  }
});

test('expanded controls use one status heading and a compact readable command', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await expect(page.locator('.connection h2')).toHaveText('No agent waiting');
  await expect(page.locator('.connection h2')).toHaveCount(1);
  await expect(page.locator('#tray #end')).toHaveCount(1);
  await expect(page.locator('.bar-controls #end')).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page
        .locator('#agent-command')
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('12px');
    expect((await page.locator('#copy-command').boundingBox())!.width).toBe(32);
    expect((await page.locator('#copy-command svg').boundingBox())!.width).toBe(
      16,
    );
    expect(
      await page
        .locator('.connection-command')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const header = (await page.locator('.connection-heading').boundingBox())!,
      power = (await page.locator('#end').boundingBox())!;
    expect(power.x + power.width).toBeCloseTo(header.x + header.width + 12, 0);
  }
  await review.expand(false);
  await expect(page.locator('#end')).not.toBeInViewport();
  await review.expand();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#end').click();
  expect(workspace.store.get(plan.session).ended).toBe(false);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#end').click();
  await expect(page.locator('.connection h2')).toHaveText('Session ended');
});

test('replacement items show an inline diff with muted context and struck deletions', async ({
  page,
  plan: _plan,
  review,
}) => {
  const before = (await review.frame.locator('h1').textContent())!;
  await review.replace('h1', before.replace('small', 'focused'));
  const item = page.locator('.draft');
  await expect(item.locator('.draft-title')).toHaveText('Text edit');
  await expect(item.locator('blockquote, dt, dd, .draft-status')).toHaveCount(
    0,
  );
  await expect(item.locator('.replacement del')).toHaveText('small');
  await expect(item.locator('.replacement ins')).toHaveText('focused');
  expect(await item.locator('.replacement span').allTextContents()).toEqual([
    'Start ',
    '. Learn something real.',
  ]);
  expect(
    await item
      .locator('del')
      .evaluate((el) => getComputedStyle(el).textDecorationLine),
  ).toBe('line-through');
  expect(
    await item
      .locator('ins')
      .evaluate((el) => getComputedStyle(el).textDecorationLine),
  ).toBe('none');
  expect(
    await item
      .locator('.replacement span')
      .first()
      .evaluate((el) => getComputedStyle(el).color),
  ).not.toBe(
    await item.locator('ins').evaluate((el) => getComputedStyle(el).color),
  );
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await item
      .locator('.replacement')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await review.replace('h1', 'Raz dva tri');
  await expect(item.locator('.replacement del')).toHaveText(before);
  await expect(item.locator('.replacement ins')).toHaveText('Raz dva tri');
  await expect(item.locator('.replacement span')).toHaveCount(0);
  await review.replace('h1', '');
  await expect(item.locator('.replacement del')).toHaveText(before);
  await expect(item.locator('.replacement span, .replacement ins')).toHaveCount(
    0,
  );
  await item
    .getByRole('button', { name: 'Delete feedback 1', exact: true })
    .click();
  await review.addComment('h1', 'Keep the original');
  await expect(item.locator('blockquote')).toHaveCount(0);
  await expect(item.locator('.replacement, .draft-status')).toHaveCount(0);
  await expect(item).toContainText('Keep the original');
  await expect(item).not.toContainText(before);
  expect((await review.state()).drafts[0].item.target?.text).toBe(before);
});
