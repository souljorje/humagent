import { test, expect } from './fixtures.ts';

test('Enter confirms comments and edits while Shift+Enter preserves line breaks', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  await review.annotate();
  const target = review.frame.locator('h1');
  const bounds = (await target.boundingBox())!;
  await target.click({
    position: { x: bounds.width - 4, y: bounds.height / 2 },
  });
  await review.note.press('Enter');
  await expect(review.note).toBeVisible();
  expect((await review.state()).drafts).toHaveLength(0);
  await review.note.fill('First line');
  await review.note.press('End');
  await review.note.press('Shift+Enter');
  await page.keyboard.type('Second line');
  await review.note.dispatchEvent('keydown', {
    key: 'Enter',
    isComposing: true,
  });
  await expect(review.note).toBeVisible();
  await review.note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  const saved = (await review.state()).drafts[0];
  expect(saved.item.comment).toBe('First line\nSecond line');
  await review.frame.locator('.marker').click();
  await review.note.fill('Updated');
  await review.note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  expect(await review.draft()).toMatchObject({
    id: saved.item.id,
    comment: 'Updated',
  });
  await review.frame.locator('.marker').click();
  await review.note.press('Enter');
  await expect(review.note).toBeVisible();
  await review.note.press('Escape');
});
