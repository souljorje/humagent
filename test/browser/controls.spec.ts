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
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const styles = (el: Element) => {
      const s = getComputedStyle(el),
        p = getComputedStyle(el, '::placeholder');
      return [s.backgroundColor, s.borderRadius, s.font, s.padding, p.color];
    };
    expect(await note.evaluate(styles)).toEqual(
      await page.locator('#message').evaluate(styles),
    );
  }
  await note.fill('Keep the wording; change its emphasis.');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
  await expect(text).toHaveCount(0);
  const item = (await review.state()).drafts[0].item;
  expect(item.comment).toBe('Keep the wording; change its emphasis.');
  expect(item.replacement).toBeUndefined();
});

test('popover follows its click point through scrolling and flips within viewport gutters', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await review.evaluate(() => {
    document.body.style.minHeight = '2500px';
    const el = document.createElement('div');
    el.id = 'click-area';
    el.style.cssText =
      'position:absolute;left:40px;top:150px;width:1300px;height:700px;background:#ddd';
    document.body.append(el);
  });
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const panel = review.frame.locator('#panel');
  await page.mouse.click(100, 220);
  await expect(panel).toBeVisible();
  let box = (await panel.boundingBox())!;
  expect(box.x).toBe(110);
  expect(box.y).toBe(230);
  await page.mouse.move(900, 700);
  expect((await panel.boundingBox())!.x).toBe(110);
  await review.evaluate(() => scrollTo(0, 80));
  await expect.poll(async () => (await panel.boundingBox())!.y).toBe(150);
  await review.frame.getByLabel('Comment', { exact: true }).press('Escape');
  await page.mouse.click(1320, 750);
  await expect(panel).toBeVisible();
  box = (await panel.boundingBox())!;
  expect(box.x + box.width).toBe(1310);
  expect(box.y).toBe(760);
  await review.frame.getByLabel('Comment', { exact: true }).press('Escape');
  await page.setViewportSize({ width: 390, height: 600 });
  await page.mouse.click(380, 520);
  await expect(panel).toBeVisible();
  box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(378);
  expect(box.y + box.height).toBeLessThanOrEqual(510);
});

test('actual text selection uses the release point and caret cursor without changing control cursors', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await review.evaluate(() => {
    const host = document.createElement('section');
    host.id = 'cursor-host';
    host.style.cssText =
      'position:fixed;left:60px;top:100px;width:600px;height:160px;background:#eee;z-index:10';
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<p id="cursor-text" style="font:24px/2 monospace;cursor:help">Select these plain words</p><button style="cursor:pointer">Native control</button>';
    document.body.prepend(host);
  });
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const target = review.frame.locator('#cursor-text');
  const bounds = await target.evaluate((el) => {
    const range = document.createRange();
    range.setStart(el.firstChild!, 7);
    range.setEnd(el.firstChild!, 12);
    const rect = range.getBoundingClientRect();
    return { x: rect.left, y: rect.top + rect.height / 2, end: rect.right };
  });
  await page.mouse.move(bounds.x, bounds.y);
  await expect
    .poll(() => target.evaluate((el) => getComputedStyle(el).cursor))
    .toBe('text');
  await page.mouse.move(600, 245);
  await expect
    .poll(() =>
      review.frame
        .locator('#cursor-host')
        .evaluate((el) => getComputedStyle(el).cursor),
    )
    .toContain('data:image/svg+xml');
  expect(
    await review.frame
      .getByRole('button', { name: 'Native control' })
      .evaluate((el) => getComputedStyle(el).cursor),
  ).toBe('pointer');
  await page.mouse.move(bounds.x, bounds.y);
  await page.mouse.down();
  await page.mouse.move(bounds.end, bounds.y, { steps: 8 });
  expect(await review.evaluate(() => getSelection()?.toString())).toBe('these');
  await page.mouse.up();
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  await expect(editor).toBeFocused();
  const panel = (await review.frame.locator('#panel').boundingBox())!;
  expect(Math.abs(panel.x - bounds.end - 10)).toBeLessThanOrEqual(1);
  expect(Math.abs(panel.y - bounds.y - 10)).toBeLessThanOrEqual(1);
  await editor.press('Escape');
  await page.locator('#annotate').click();
  await expect
    .poll(() => target.evaluate((el) => getComputedStyle(el).cursor))
    .toBe('help');
});

test('ARIA controls and their nested shadow roots retain their cursors', async ({
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
  await expect.poll(() => cursor('#control-text')).toBe('text');
  await review.frame
    .locator('#control-host')
    .evaluate((el) => el.setAttribute('role', 'button'));
  await expect.poll(() => cursor('#control-text')).toBe('pointer');
  await review.frame
    .locator('#control-host')
    .evaluate((el) => el.removeAttribute('role'));
  await expect.poll(() => cursor('#control-text')).toBe('text');
  await page.locator('#annotate').click();
  await expect.poll(() => cursor('#control-text')).toBe('pointer');
});

test('keyboard activation anchors at the selection endpoint or marker center', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await review.evaluate(() => {
    const el = document.createElement('p');
    el.id = 'keyboard-text';
    el.textContent = 'Plain text for keyboard review';
    el.style.cssText =
      'position:fixed;left:60px;top:100px;width:260px;font:20px monospace';
    document.body.prepend(el);
  });
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const endpoint = await review.evaluate(() => {
    const el = document.querySelector('#keyboard-text')!;
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 5);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    const point = range.cloneRange();
    point.collapse(false);
    const rect = point.getBoundingClientRect();
    el.dispatchEvent(
      new KeyboardEvent('keyup', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );
    return { x: rect.left, y: rect.bottom };
  });
  const panel = review.frame.locator('#panel');
  await expect(panel).toBeVisible();
  let box = (await panel.boundingBox())!;
  expect(Math.abs(box.x - endpoint.x - 10)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y - endpoint.y - 10)).toBeLessThanOrEqual(1);
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Keyboard feedback');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
  await expect(panel).toBeHidden();
  const marker = review.frame.locator('.marker');
  const point = (await marker.boundingBox())!;
  await marker.focus();
  await marker.press('Enter');
  await expect(panel).toBeVisible();
  box = (await panel.boundingBox())!;
  expect(box.x).toBe(point.x + point.width / 2 + 10);
  expect(box.y).toBe(point.y + point.height / 2 + 10);
});
