import { test, expect } from './fixtures.ts';

test.use({ hasTouch: true });

for (const existing of [false, true])
  test(`a click places an editing caret in ${existing ? 'an existing app' : 'a mini-app'}`, async ({
    page,
    review,
    workspace,
    app,
  }) => {
    const opened = await review.open(existing ? app.origin : workspace.file());
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
    await page.locator('#annotate').click();
    await expect(page.locator('#annotate')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.mouse.click(point.x, point.y);
    const editor = review.frame.getByRole('textbox', {
      name: 'Edit text',
      exact: true,
    });
    await expect(editor).toBeFocused();
    expect(
      await review.evaluate(() => ({
        collapsed: getSelection()!.isCollapsed,
        offset: getSelection()!.focusOffset,
      })),
    ).toEqual({ collapsed: true, offset });
    await expect(
      review.frame.getByRole('button', { name: 'Confirm text edit' }),
    ).toBeDisabled();
    expect((await review.state()).drafts).toHaveLength(0);
    await page.keyboard.type('direct ');
    const after = before.slice(0, offset) + 'direct ' + before.slice(offset);
    await expect(editor).toHaveText(after);
    await review.frame
      .getByLabel('Comment', { exact: true })
      .fill('Explain the wording');
    await review.frame
      .getByRole('button', { name: 'Confirm text edit' })
      .click();
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
    await page.locator('#send').click();
    await expect(review.frame.locator('.marker')).toHaveCount(0);
    await page.mouse.click(point.x, point.y);
    await expect(editor).toHaveCount(0);
    await expect(
      review.frame.getByLabel('Comment', { exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    const received = workspace.store.take(opened.session, 'direct-edit');
    if (received?.status !== 'feedback') throw new Error('Expected feedback');
    workspace.store.acknowledge(opened.session, received.receipt);
    await expect(target).toHaveText(before);
    await page.locator('#annotate').click();
    await expect(page.locator('#annotate')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.mouse.click(point.x, point.y);
    await expect(review.frame.getByRole('dialog')).toBeHidden();
  });

test('direct shadow-root editing preserves caret movement and native word selection', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.evaluate(() => {
    const host = document.createElement('section');
    host.id = 'direct-shadow';
    host.style.cssText =
      'position:fixed;left:50px;top:60px;width:600px;z-index:10';
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<p id="direct-words" style="font:24px monospace">Alpha beta gamma</p>';
    document.body.prepend(host);
  });
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const target = review.frame.locator('#direct-words');
  const point = await target.evaluate((el) => {
    const range = document.createRange();
    range.setStart(el.firstChild!, 6);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  await expect(editor).toBeFocused();
  await page.keyboard.type('new ');
  await expect(editor).toHaveText('Alpha new beta gamma');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.type('next ');
  await expect(editor).toHaveText('Alpha next new beta gamma');
  await page.mouse.dblclick(point.x + 3, point.y);
  expect(await review.evaluate(() => getSelection()!.toString())).toBe('next');
  await editor.press('Escape');
  await expect(target).toHaveText('Alpha beta gamma');
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
  await expect(editor).toBeFocused();
  expect(await review.evaluate(() => getSelection()!.focusOffset)).toBe(
    'Editable text'.length,
  );
  await editor.press('Escape');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(
    review.frame.getByLabel('Comment', { exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await page.mouse.click(600, 120);
  await expect(editor).toHaveCount(0);
  await expect(
    review.frame.getByLabel('Comment', { exact: true }),
  ).toBeFocused();
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

for (const touch of [false, true])
  test(`new nested shadow roots support direct ${touch ? 'taps' : 'stationary clicks'}`, async ({
    page,
    plan: _plan,
    review,
  }) => {
    await review.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'late-shadow';
      host.style.cssText =
        'position:fixed;left:50px;top:50px;width:600px;height:100px;font:24px/2 monospace';
      document.body.prepend(host);
    });
    await page.locator('#annotate').click();
    await expect(page.locator('#annotate')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.mouse.move(150, 74);
    await review.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      const root = document
        .querySelector('#late-shadow')!
        .attachShadow({ mode: 'open' });
      root.innerHTML = '<div id="late-inner"></div>';
      root
        .querySelector('#late-inner')!
        .attachShadow({ mode: 'open' }).innerHTML =
        '<p id="late-words" style="margin:0">Alpha beta gamma</p>';
    });
    if (touch) await page.touchscreen.tap(150, 74);
    else {
      await page.mouse.down();
      await page.mouse.up();
    }
    const editor = review.frame.getByRole('textbox', {
      name: 'Edit text',
      exact: true,
    });
    await expect(editor).toBeFocused();
    expect(await review.evaluate(() => getSelection()!.isCollapsed)).toBe(true);
    await page.keyboard.type('new ');
    await expect(editor).toContainText('new ');
    await editor.press('Escape');
    await expect(review.frame.locator('#late-words')).toHaveText(
      'Alpha beta gamma',
    );
  });
