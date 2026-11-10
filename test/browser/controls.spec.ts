import { test, expect } from './fixtures.ts';

test('one popover confirms text and comments together and cancels either field', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.replace('h1', 'Saved wording');
  const original = await review.draft();
  await review.frame.locator('.marker').click();
  const save = review.frame.getByRole('button', { name: 'Save', exact: true });
  await expect(review.editor).toBeFocused();
  await expect(review.frame.getByRole('dialog')).toHaveCount(1);
  await expect(save).toBeDisabled();
  await review.note.fill('Explain this change');
  await expect(save).toBeEnabled();
  await review.editor.fill('Better wording');
  await save.click();
  await expect(review.editor).toHaveCount(0);
  expect(await review.draft()).toMatchObject({
    id: original.id,
    comment: 'Explain this change',
    replacement: {
      before: original.replacement!.before,
      after: 'Better wording',
    },
  });
  await review.frame.locator('.marker').click();
  await expect(save).toBeDisabled();
  await review.note.fill('Unconfirmed reason');
  await expect(page.locator('#send')).toBeDisabled();
  await page.mouse.click(2, 2);
  await expect(review.note).toBeFocused();
  expect(
    await review.frame
      .locator('#panel')
      .evaluate((el) =>
        el.getAnimations().some((a) => a.effect?.getTiming().duration === 180),
      ),
  ).toBe(true);
  await review.note.press('Escape');
  expect((await review.draft()).comment).toBe('Explain this change');
  await review.frame.locator('.marker').click();
  await review.note.fill('Remove this wording');
  await review.editor.fill('');
  await save.click();
  await expect(review.editor).toHaveCount(0);
  expect(await review.draft()).toMatchObject({
    comment: 'Remove this wording',
    replacement: { after: '' },
  });
  await review.frame.locator('.marker').click();
  await review.note.fill('Discard this');
  await review.editor.fill('Discard this too');
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(review.frame.locator('h1')).toHaveText('');
  expect((await review.draft()).comment).toBe('Remove this wording');
});

test('a selected text comment omits a no-op replacement and shares bar input styles', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.annotate();
  await review.selectText('h1');
  await expect(review.editor).toBeFocused();
  await expect(
    review.frame.getByRole('button', { name: 'Confirm text edit' }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 900 });
  const styles = (el: Element) => {
    const s = getComputedStyle(el),
      p = getComputedStyle(el, '::placeholder');
    return [s.backgroundColor, s.borderRadius, s.font, s.padding, p.color];
  };
  expect(await review.note.evaluate(styles)).toEqual(
    await page.locator('#message').evaluate(styles),
  );
  await review.note.fill('Keep the wording; change its emphasis.');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
  await expect(review.editor).toHaveCount(0);
  const item = await review.draft();
  expect(item.comment).toBe('Keep the wording; change its emphasis.');
  expect(item.replacement).toBeUndefined();
});

test('ARIA controls retain their native cursors while commenting', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'control-host';
    host.style.cursor = 'pointer';
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<div id="nested-control"></div>';
    host
      .shadowRoot!.querySelector('div')!
      .attachShadow({ mode: 'open' }).innerHTML =
      '<span id="control-text">Custom action</span>';
    const checkbox = document.createElement('div');
    checkbox.id = 'custom-checkbox';
    checkbox.role = 'checkbox';
    checkbox.style.cursor = 'pointer';
    checkbox.textContent = 'Custom checkbox';
    const toggle = document.createElement('div');
    toggle.id = 'unstyled-switch';
    toggle.role = 'switch';
    toggle.textContent = 'Unstyled switch';
    document.body.prepend(host, checkbox, toggle);
  });
  await review.annotate();
  const cursor = (selector: string) =>
    review.frame
      .locator(selector)
      .evaluate((el) => getComputedStyle(el).cursor);
  await expect.poll(() => cursor('#custom-checkbox')).toBe('pointer');
  await review.frame.locator('#unstyled-switch').hover();
  await expect.poll(() => cursor('#unstyled-switch')).toBe('auto');
  await review.frame.locator('#control-text').hover();
  await expect.poll(() => cursor('#control-text')).toBe('pointer');
  await review.frame
    .locator('#control-host')
    .evaluate((el) => el.setAttribute('role', 'button'));
  await expect.poll(() => cursor('#control-text')).toBe('pointer');
  await review.frame
    .locator('#control-host')
    .evaluate((el) => el.removeAttribute('role'));
  await expect.poll(() => cursor('#control-text')).toBe('pointer');
  await page.locator('#annotate').click();
  await expect.poll(() => cursor('#control-text')).toBe('pointer');
});
