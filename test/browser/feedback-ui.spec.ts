import { test, expect } from './fixtures.ts';

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
    expect(power.x + power.width).toBeCloseTo(header.x + header.width, 0);
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

test('replacement items show one before and after with only actionable status', async ({
  page,
  plan: _plan,
  review,
}) => {
  const before = (await review.frame.locator('h1').textContent())!;
  await review.replace('h1', 'A clearer heading');
  const item = page.locator('.draft');
  await expect(item.locator('.draft-title')).toHaveText('Text edit');
  await expect(item.locator('blockquote, del, ins, .draft-status')).toHaveCount(
    0,
  );
  await expect(item.locator('.replacement dt')).toHaveText(['Before', 'After']);
  await expect(item.locator('.replacement dd')).toHaveText([
    before,
    'A clearer heading',
  ]);
  await review.replace('h1', '');
  await expect(item.locator('.replacement dd')).toHaveText([
    before,
    'Delete this text',
  ]);
  await item.getByRole('button', { name: 'Remove', exact: true }).click();
  await review.addComment('h1', 'Keep the original');
  await expect(item.locator('blockquote')).toHaveCount(1);
  await expect(item.locator('.replacement, .draft-status')).toHaveCount(0);
  await expect(item).toContainText('Keep the original');
});
