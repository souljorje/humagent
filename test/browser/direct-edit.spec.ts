import { test, expect } from './fixtures.ts';

test.use({ hasTouch: true });

test('a click places an editing caret in a mini-app', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const annotate = page.locator('#annotate');
  const target = review.frame.locator('h1');
  const before = (await target.textContent())!;
  const offset = before.indexOf(' ') + 1;
  const point = await target.evaluate((el, offset) => {
    const range = document.createRange();
    range.setStart(el.firstChild!, offset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  }, offset);
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(point.x, point.y);
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  const comment = review.frame.getByLabel('Comment', { exact: true });
  const confirm = review.frame.getByRole('button', {
    name: 'Confirm text edit',
  });
  await expect(editor).toBeFocused();
  expect(
    await review.evaluate(() => ({
      collapsed: getSelection()!.isCollapsed,
      offset: getSelection()!.focusOffset,
    })),
  ).toEqual({ collapsed: true, offset });
  await expect(confirm).toBeDisabled();
  expect((await review.state()).drafts).toHaveLength(0);
  await page.keyboard.type('direct ');
  const after = before.slice(0, offset) + 'direct ' + before.slice(offset);
  await expect(editor).toHaveText(after);
  await comment.fill('Explain the wording');
  await confirm.click();
  await expect(editor).toHaveCount(0);
  const first = (await review.state()).drafts[0].item;
  expect(first).toMatchObject({
    comment: 'Explain the wording',
    replacement: { before, after },
  });
  await page.mouse.click(point.x, point.y);
  await expect(editor).toBeFocused();
  await page.keyboard.type('discard ');
  await editor.press('Escape');
  await expect(target).toHaveText(after);
  expect((await review.state()).drafts[0].item).toEqual(first);
  await review.connect();
  await page.locator('#send').click();
  await expect(review.frame.locator('.marker')).toHaveCount(0);
  await page.mouse.click(point.x, point.y);
  await expect(editor).toHaveCount(0);
  await expect(comment).toBeFocused();
  await page.keyboard.press('Escape');
  const received = await review.receive();
  if (received?.status !== 'feedback') throw new Error('Expected feedback');
  workspace.store.acknowledge(plan.session, received.receipt);
  await expect(target).toHaveText(before);
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.click(point.x, point.y);
  await expect(review.frame.getByRole('dialog')).toBeHidden();
});

test('padding stays a comment target and keyboard activation edits only one direct text node', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.evaluate(() => {
    const plain = document.createElement('h1');
    plain.id = 'direct-plain';
    plain.textContent = 'Editable text';
    plain.style.cssText =
      'position:fixed;left:50px;top:40px;width:600px;height:100px;margin:0;font:24px monospace';
    const mixed = document.createElement('h2');
    mixed.id = 'direct-mixed';
    mixed.innerHTML = 'Plain <strong>formatted</strong> tail';
    document.body.prepend(plain, mixed);
  });
  await page.locator('#annotate').focus();
  await page.keyboard.press('Enter');
  await expect(review.frame.locator('#keyboard-hint')).toBeVisible();
  await page.keyboard.press('Enter');
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  const comment = review.frame.getByLabel('Comment', { exact: true });
  await expect(editor).toBeFocused();
  expect(await review.evaluate(() => getSelection()!.focusOffset)).toBe(
    'Editable text'.length,
  );
  await editor.press('Escape');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(comment).toBeFocused();
  await page.keyboard.press('Escape');
  await page.mouse.click(600, 120);
  await expect(editor).toHaveCount(0);
  await expect(comment).toBeFocused();
});

test('SVG labels remain usable comment targets', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.evaluate(() => {
    const target = document.createElement('div');
    target.style.cssText = 'position:fixed;left:50px;top:50px';
    target.innerHTML =
      '<svg width="400" height="100"><text id="svg-label" x="0" y="30" font-size="24">Chart label</text></svg>';
    document.body.prepend(target);
  });
  await page.locator('#annotate').click();
  await review.frame.locator('#svg-label').click();
  await expect(
    review.frame.getByRole('textbox', { name: 'Edit text', exact: true }),
  ).toHaveCount(0);
  const comment = review.frame.getByLabel('Comment', { exact: true });
  await expect(comment).toBeFocused();
  await comment.fill('Explain the chart');
  await review.frame.getByRole('button', { name: 'Add comment' }).click();
  await expect
    .poll(async () => (await review.state()).drafts[0]?.item.comment)
    .toBe('Explain the chart');
  await expect(review.frame.locator('#svg-label')).toHaveText('Chart label');
});
