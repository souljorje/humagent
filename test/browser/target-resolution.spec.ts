import { test, expect } from './fixtures.ts';

test('comments follow selectors through text changes and rerenders in a mini-app', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  await review.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'comment-host';
    host.style.cssText = 'position:fixed;left:40px;top:40px;width:400px';
    host.innerHTML =
      '<section style="height:180px;padding:20px"><p>Live section</p><button>Count: 0</button></section>';
    document.body.prepend(host);
  });
  await page.locator('#annotate').click();
  const target = review.frame.locator('#comment-host section');
  await target.click({ position: { x: 350, y: 160 } });
  const note = review.frame.getByLabel('Comment', { exact: true });
  const status = page.locator('.draft-status');
  await note.fill('Keep this comment attached');
  await note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  const original = (await review.state()).drafts[0];
  await target
    .locator('button')
    .evaluate((el) => (el.textContent = 'Count: 3'));
  await review.frame.locator('.marker').click();
  await expect(note).toHaveValue('Keep this comment attached');
  await note.fill('Updated comment');
  await target.evaluate((el) => el.replaceWith(el.cloneNode(true)));
  await note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  await expect(status).toHaveCount(0);
  const updated = (await review.state()).drafts[0];
  expect(updated.item.id).toBe(original.item.id);
  expect(updated.item.target).toEqual(original.item.target);
  expect(updated.item.comment).toBe('Updated comment');
  await target.evaluate((el) => el.remove());
  await expect(status).toContainText('Target unavailable');
  await review.evaluate(() => {
    document.querySelector('#comment-host')!.innerHTML =
      '<section style="height:180px;padding:20px">Replacement content</section>';
  });
  await expect(status).toHaveCount(0);
  await review.frame.locator('.marker').click();
  await expect(note).toHaveValue('Updated comment');
  await target.evaluate((el) => el.after(el.cloneNode(true)));
  await expect(status).toContainText('Target unavailable');
});
