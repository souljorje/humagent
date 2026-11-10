import { test, expect } from './fixtures.ts';

test('indented source text stays readable in the inline diff', async ({
  page,
  review,
  workspace,
}) => {
  await review.open(workspace.file('plan.html'));
  const before = (await review.frame.locator('.lede').textContent())!;
  expect(before).toMatch(/\n\s+/);
  await review.replace('.lede', '');
  await review.expand();
  const diff = page.locator('.replacement');
  await expect(diff.locator('del')).toHaveText(before);
  expect((await review.state()).drafts[0].item.replacement).toEqual({
    before,
    after: '',
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(diff).toHaveCSS('white-space', 'normal');
  expect(
    await diff.evaluate(
      (el) =>
        el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth,
    ),
  ).toBe(true);
});

test('expanded controls use one status heading and a compact readable command', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const heading = page.locator('.connection h2');
  const end = page.locator('#end');
  await expect(heading).toHaveText('No agent waiting');
  await expect(heading).toHaveCount(1);
  await expect(page.locator('#tray #end')).toHaveCount(1);
  await expect(page.locator('.bar-controls #end')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
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
    power = (await end.boundingBox())!;
  expect(power.x + power.width).toBeCloseTo(header.x + header.width + 12, 0);
  await review.expand(false);
  await expect(end).not.toBeInViewport();
  await review.expand();
  page.once('dialog', (dialog) => dialog.dismiss());
  await end.click();
  expect(workspace.store.get(plan.session).ended).toBe(false);
  page.once('dialog', (dialog) => dialog.accept());
  await end.click();
  await expect(heading).toHaveText('Session ended');
});
