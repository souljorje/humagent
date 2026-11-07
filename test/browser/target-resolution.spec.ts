import { test, expect } from './fixtures.ts';

for (const existing of [false, true])
  for (const shadow of [false, true])
    test(`comments follow selectors through text changes and rerenders in ${existing ? 'an existing app' : 'a mini-app'}${shadow ? ' with shadow roots' : ''}`, async ({
      page,
      plan: _plan,
      review,
      app,
    }) => {
      if (existing) await review.open(app.origin);
      await review.expand(false);
      await review.evaluate((shadow) => {
        const host = document.createElement('div');
        host.id = 'comment-host';
        host.style.cssText = 'position:fixed;left:40px;top:40px;width:400px';
        const root = shadow ? host.attachShadow({ mode: 'open' }) : host;
        root.innerHTML =
          '<section style="height:180px;padding:20px"><p>Live section</p><button>Count: 0</button></section>';
        document.body.prepend(host);
      }, shadow);
      await page.locator('#annotate').click();
      const target = review.frame.locator('#comment-host section');
      await target.click({ position: { x: 350, y: 160 } });
      const note = review.frame.getByLabel('Comment', { exact: true });
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
      await expect(page.locator('.draft-status')).toHaveCount(0);
      const updated = (await review.state()).drafts[0];
      expect(updated.item.id).toBe(original.item.id);
      expect(updated.item.target).toEqual(original.item.target);
      expect(updated.item.comment).toBe('Updated comment');
      await target.evaluate((el) => el.remove());
      await expect(page.locator('.draft-status')).toContainText(
        'Target unavailable',
      );
      await review.evaluate((shadow) => {
        const host = document.querySelector('#comment-host')!;
        const root = shadow ? host.shadowRoot! : host;
        root.innerHTML =
          '<section style="height:180px;padding:20px">Replacement content</section>';
      }, shadow);
      await expect(page.locator('.draft-status')).toHaveCount(0);
      await review.frame.locator('.marker').click();
      await expect(note).toHaveValue('Updated comment');
      await target.evaluate((el) => el.after(el.cloneNode(true)));
      await expect(page.locator('.draft-status')).toContainText(
        'Target unavailable',
      );
    });

test('replacement feedback stays editable after application text and markup changes', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  await review.evaluate(() => {
    const heading = document.querySelector('h1')!;
    heading.innerHTML = 'Original text<span>Counter: 0</span>';
  });
  await review.replace('h1', 'Proposed text');
  await review.frame
    .locator('h1 span')
    .evaluate((el) => (el.textContent = 'Counter: 1'));
  await review.frame.locator('.marker').click();
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.fill('Revised text');
  await review.frame
    .locator('h1 > span:not([data-humagent-ui])')
    .evaluate((el) => (el.textContent = 'Counter: 2'));
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.draft-status')).toHaveCount(0);
  await review.frame
    .locator('h1')
    .evaluate((el) => (el.firstChild!.nodeValue = 'Application update'));
  await expect(page.locator('.draft-status')).toHaveCount(0);
  await review.frame.locator('.marker').click();
  await expect(editor).toHaveText('Revised text');
  const note = review.frame.getByLabel('Comment', { exact: true });
  await note.fill('Keep this suggestion');
  await note.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(review.frame.locator('h1')).toHaveText(
    'Application updateCounter: 2',
  );
  expect((await review.state()).drafts[0].item).toMatchObject({
    replacement: { before: 'Original text', after: 'Revised text' },
    comment: 'Keep this suggestion',
  });
  await review.frame.locator('h1').evaluate((el) => {
    const next = el.cloneNode(false) as Element;
    next.innerHTML = '<strong>New markup</strong>';
    el.replaceWith(next);
  });
  await review.frame.locator('.marker').click();
  await expect(note).toHaveValue('Keep this suggestion');
  await note.fill('Still attached');
  await note.press('Enter');
  await expect(review.frame.locator('h1')).toHaveText('New markup');
  expect((await review.state()).drafts[0].item.replacement).toEqual({
    before: 'Original text',
    after: 'Revised text',
  });
});
