import { test, expect } from './fixtures.ts';

test('surface iframe is sandboxed', async ({ page, review }) => {
  await review.open();
  const sandbox = await page.locator('#frame').getAttribute('sandbox');
  expect(sandbox).toContain('allow-scripts');
  expect(sandbox).toContain('allow-forms');
  expect(sandbox).toContain('allow-same-origin');
  expect(sandbox).not.toContain('allow-top-navigation');
  expect(sandbox).not.toContain('allow-popups');
  await expect(review.frame.locator('h1')).toBeVisible();
});
