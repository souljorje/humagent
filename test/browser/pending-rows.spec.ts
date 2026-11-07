import { test, expect } from './fixtures.ts';

test('feedback rows highlight targets, open editors, and delete independently', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await review.addComment('h1', 'First comment');
  await review.addComment('[data-humagent-id="brief"]', 'Second comment');
  await review.expand();
  const rows = page.locator('.draft');
  await expect(
    rows.getByRole('button', { name: 'Edit', exact: true }),
  ).toHaveCount(0);
  await expect(
    rows.getByRole('button', { name: 'Remove', exact: true }),
  ).toHaveCount(0);
  const highlight = review.frame.locator('#highlight');
  const markers = review.frame.locator('.marker');
  const firstTarget = (await review.frame.locator('h1').boundingBox())!;
  await rows.nth(0).hover();
  await expect(highlight).toBeVisible();
  await expect(markers.nth(0)).toHaveCSS('opacity', '1');
  await expect(markers.nth(0)).not.toHaveCSS(
    'outline-color',
    'rgb(22, 133, 255)',
  );
  await expect(markers.nth(1)).not.toHaveClass(/highlighted/);
  await expect(markers.nth(1)).toHaveCSS('opacity', '0.72');
  await expect
    .poll(async () => (await highlight.boundingBox())!.y)
    .toBeCloseTo(firstTarget.y, 0);
  await rows.nth(0).click({ position: { x: 8, y: 40 } });
  const note = review.frame.getByLabel('Comment', { exact: true });
  await expect(note).toHaveValue('First comment');
  await expect(markers.nth(0)).toHaveCSS('opacity', '1');
  const panel = (await review.frame.locator('#panel').boundingBox())!;
  const secondTarget = (await review.frame
    .locator('[data-humagent-id="brief"]')
    .boundingBox())!;
  await rows.nth(1).hover();
  await expect(markers.nth(1)).toHaveCSS('opacity', '1');
  await expect(markers.nth(0)).not.toHaveClass(/highlighted/);
  await expect
    .poll(async () => (await highlight.boundingBox())!.y)
    .toBeCloseTo(secondTarget.y, 0);
  expect((await review.frame.locator('#panel').boundingBox())!.y).toBeCloseTo(
    panel.y,
    0,
  );
  await expect(note).toHaveValue('First comment');
  await page.locator('#message').hover();
  await expect(review.frame.locator('.marker.highlighted')).toHaveCount(0);
  await expect(markers.nth(1)).toHaveCSS('opacity', '0.72');
  await rows.nth(1).click({ position: { x: 8, y: 40 } });
  await expect(note).toHaveValue('Second comment');
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  const first = page.getByRole('button', {
    name: 'Edit feedback 1',
    exact: true,
  });
  await first.focus();
  await expect(markers.nth(0)).toHaveCSS('opacity', '1');
  await first.press('Enter');
  await expect(note).toHaveValue('First comment');
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  const id = (await review.state()).drafts[0].item.id;
  const trash = page.getByRole('button', {
    name: 'Delete feedback 2',
    exact: true,
  });
  expect((await trash.boundingBox())!.x).toBeGreaterThan(
    (await rows.nth(1).boundingBox())!.x + 300,
  );
  await trash.click();
  await expect(rows).toHaveCount(1);
  await expect(review.frame.locator('#panel')).toBeHidden();
  expect((await review.state()).drafts[0].item.id).toBe(id);
});

test('unavailable feedback retains an independent trash action', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'Remove this');
  await review.frame.locator('h1').evaluate((el) => el.remove());
  await review.expand();
  await expect(
    page.getByRole('button', { name: 'Edit feedback 1', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Delete feedback 1', exact: true })
    .click();
  await expect(page.locator('.draft')).toHaveCount(0);
});
