import { test, expect } from './fixtures.ts';

test('one popover confirms text and comments together and cancels either field', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.replace('h1', 'Saved wording');
  const original = (await review.state()).drafts[0].item;
  await review.frame.locator('.marker').click();
  const text = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  const note = review.frame.getByLabel('Comment', { exact: true });
  const save = review.frame.getByRole('button', { name: 'Save', exact: true });
  await expect(text).toBeFocused();
  await expect(review.frame.getByRole('dialog')).toHaveCount(1);
  await expect(save).toBeDisabled();
  await note.fill('Explain this change');
  await expect(save).toBeEnabled();
  await text.fill('Better wording');
  await save.click();
  await expect(text).toHaveCount(0);
  expect((await review.state()).drafts[0].item).toMatchObject({
    id: original.id,
    comment: 'Explain this change',
    replacement: {
      before: original.replacement!.before,
      after: 'Better wording',
    },
  });
  await review.frame.locator('.marker').click();
  await expect(save).toBeDisabled();
  await note.fill('Unconfirmed reason');
  await expect(page.locator('#send')).toBeDisabled();
  await page.mouse.click(2, 2);
  await expect(note).toBeFocused();
  expect(
    await review.frame
      .locator('#panel')
      .evaluate((el) =>
        el.getAnimations().some((a) => a.effect?.getTiming().duration === 180),
      ),
  ).toBe(true);
  await note.press('Escape');
  expect((await review.state()).drafts[0].item.comment).toBe(
    'Explain this change',
  );
  await review.frame.locator('.marker').click();
  await note.fill('Remove this wording');
  await text.fill('');
  await save.click();
  await expect(text).toHaveCount(0);
  expect((await review.state()).drafts[0].item).toMatchObject({
    comment: 'Remove this wording',
    replacement: { after: '' },
  });
  await review.frame.locator('.marker').click();
  await note.fill('Discard this');
  await text.fill('Discard this too');
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(review.frame.locator('h1')).toHaveText('');
  expect((await review.state()).drafts[0].item.comment).toBe(
    'Remove this wording',
  );
});

test('a selected text comment omits a no-op replacement and shares bar input styles', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await review.evaluate(() => {
    const node = document.querySelector('h1')!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    node.parentElement!.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true }),
    );
  });
  const text = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  const note = review.frame.getByLabel('Comment', { exact: true });
  await expect(text).toBeFocused();
  await expect(
    review.frame.getByRole('button', { name: 'Confirm text edit' }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 900 });
  const styles = (el: Element) => {
    const s = getComputedStyle(el),
      p = getComputedStyle(el, '::placeholder');
    return [s.backgroundColor, s.borderRadius, s.font, s.padding, p.color];
  };
  expect(await note.evaluate(styles)).toEqual(
    await page.locator('#message').evaluate(styles),
  );
  await note.fill('Keep the wording; change its emphasis.');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
  await expect(text).toHaveCount(0);
  const item = (await review.state()).drafts[0].item;
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
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
