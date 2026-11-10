import { test, expect } from './fixtures.ts';

test('Enter confirms comments and edits while Shift+Enter preserves line breaks', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  await page.locator('#annotate').click();
  const target = review.frame.locator('h1');
  const bounds = (await target.boundingBox())!;
  await target.click({
    position: { x: bounds.width - 4, y: bounds.height / 2 },
  });
  const note = review.frame.getByLabel('Comment', { exact: true });
  await note.press('Enter');
  await expect(note).toBeVisible();
  expect((await review.state()).drafts).toHaveLength(0);
  await note.fill('First line');
  await note.press('End');
  await note.press('Shift+Enter');
  await page.keyboard.type('Second line');
  await note.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(note).toBeVisible();
  await note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  const saved = (await review.state()).drafts[0];
  expect(saved.item.comment).toBe('First line\nSecond line');
  await review.frame.locator('.marker').click();
  await note.fill('Updated');
  await note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  expect((await review.state()).drafts[0].item).toMatchObject({
    id: saved.item.id,
    comment: 'Updated',
  });
  await review.frame.locator('.marker').click();
  await note.press('Enter');
  await expect(note).toBeVisible();
  await note.press('Escape');
});
