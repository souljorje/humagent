import fs from 'node:fs';
import { test, expect } from './fixtures.ts';

for (const existing of [false, true])
  test(`acknowledgment preserves same-value application writes in ${existing ? 'an existing app' : 'a mini-app'}`, async ({
    page,
    review,
    workspace,
    app,
  }) => {
    const opened = await review.open(existing ? app.origin : workspace.file());
    await review.replace('h1', 'Application wording');
    await page.locator('#send').click();
    await expect(review.frame.locator('.marker')).toHaveCount(0);
    await review.evaluate(() => {
      document.querySelector('h1')!.firstChild!.nodeValue =
        'Application wording';
    });
    const received = workspace.store.take(opened.session, 'same-value-test');
    if (received?.status !== 'feedback') throw new Error('Expected feedback');
    workspace.store.acknowledge(opened.session, received.receipt);
    await expect(page.locator('#activity')).toHaveText('Completed');
    await expect(review.frame.locator('h1')).toHaveText('Application wording');
  });

test('native paste preserves trailing newlines exactly', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.replace('h1', 'Preview');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await review.evaluate(async () =>
    navigator.clipboard.writeText('First\nSecond\n'),
  );
  await review.frame.locator('.marker').click();
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  await editor.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  expect((await review.state()).drafts[0].item.replacement?.after).toBe(
    'First\nSecond\n',
  );
});

test('physical clicks on disabled Send dismiss edits without sending', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.replace('h1', 'Saved preview');
  await review.frame.locator('.marker').click();
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  await editor.fill('Unconfirmed edit');
  await expect(page.locator('#send')).toBeDisabled();
  const box = (await page.locator('#send').boundingBox())!;
  const click = () =>
    page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('Unconfirmed edit');
  await click();
  await expect(editor).toHaveCount(0);
  await expect(review.frame.locator('h1')).toHaveText('Saved preview');
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
});

test('acknowledgment removes an uncertain preview while retry still confirms its immutable batch', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const original = await review.frame.locator('h1').textContent();
  await review.replace('h1', 'Uncertain preview');
  const route = `**/api/sessions/${plan.session}/events`;
  await page.route(route, async (request) => {
    await request.fetch();
    await request.abort();
  });
  await page.locator('#send').click();
  await expect(page.locator('#error')).toBeVisible();
  const received = workspace.store.take(plan.session, 'uncertain-preview');
  if (received?.status !== 'feedback') throw new Error('Expected feedback');
  workspace.store.acknowledge(plan.session, received.receipt);
  await expect(review.frame.locator('h1')).toHaveText(original!);
  expect((await review.state()).outbox).toHaveLength(1);
  await page.unroute(route);
  await page.getByRole('button', { name: 'Retry send' }).click();
  await expect(review.frame.locator('.marker')).toHaveCount(0);
  expect((await review.state()).outbox).toHaveLength(0);
  await expect(review.frame.locator('h1')).toHaveText(original!);
});

test('selected words edit in place, repeat edits keep evidence and IDs, and cancellation restores previews', async ({
  page,
  plan: _plan,
  review,
  workspace,
}) => {
  const source = fs.readFileSync(workspace.file(), 'utf8');
  const before = (await review.frame.locator('h1').textContent())!;
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const selected = await review.evaluate(() => {
    const el = document.querySelector('h1')!;
    const node = el.firstChild!;
    const start = node.textContent!.search(/\S/);
    const end = start + node.textContent!.slice(start).match(/^\S+/)![0].length;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { start, end };
  });
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  await expect(editor).toBeFocused();
  expect(await review.evaluate(() => getSelection()?.toString())).toBe(
    before.slice(selected.start, selected.end),
  );
  await page.keyboard.type('Better');
  await expect(page.locator('#send')).toBeDisabled();
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  const after =
    before.slice(0, selected.start) + 'Better' + before.slice(selected.end);
  await expect(review.frame.locator('h1')).toHaveText(after);
  const first = (await review.state()).drafts[0].item;
  expect(first.replacement).toEqual({ before, after });
  expect(first.target?.text).toBe(before.trim().replace(/\s+/g, ' '));
  await review.replace('h1', 'Final wording');
  const repeated = (await review.state()).drafts;
  expect(repeated).toHaveLength(1);
  expect(repeated[0].item).toMatchObject({
    id: first.id,
    replacement: { before, after: 'Final wording' },
  });
  await review.frame.locator('.marker').click();
  await expect(
    review.frame.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await editor.fill('Unconfirmed');
  await editor.press('Escape');
  await expect(review.frame.locator('h1')).toHaveText('Final wording');
  await review.frame.locator('.marker').click();
  await review.frame.getByRole('button', { name: 'Delete comment' }).click();
  await expect(review.frame.locator('h1')).toHaveText(before);
  expect(fs.readFileSync(workspace.file(), 'utf8')).toBe(source);
});

test('submitted previews remain read only until their own receipt completes, including reload', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const original = await review.frame.locator('h1').textContent();
  await review.replace('h1', 'First preview');
  await page.locator('#send').click();
  await expect(review.frame.locator('.marker')).toHaveCount(0);
  await expect(review.frame.locator('h1')).toHaveText('First preview');
  const first = workspace.store.take(plan.session, 'preview-test')!;
  expect(first.status).toBe('feedback');
  if (first.status !== 'feedback') throw new Error('Expected feedback');
  await page.reload();
  await review.ready();
  await expect(review.frame.locator('h1')).toHaveText('First preview');
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await review.evaluate(() => {
    const el = document.querySelector('h1')!;
    const range = document.createRange();
    range.selectNodeContents(el.firstChild!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(
    review.frame.getByRole('textbox', { name: 'Edit text', exact: true }),
  ).toHaveCount(0);
  await review.evaluate(() => getSelection()!.removeAllRanges());
  const secondOriginal = await review.frame
    .locator('[data-humagent-id="brief"]')
    .textContent();
  await review.replace('[data-humagent-id="brief"]', 'Second preview');
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(plan.session).events.length)
    .toBe(2);
  workspace.store.acknowledge(plan.session, first.receipt);
  await expect(review.frame.locator('h1')).toHaveText(original!);
  await expect(review.frame.locator('[data-humagent-id="brief"]')).toHaveText(
    'Second preview',
  );
  const second = workspace.store.take(plan.session, 'preview-test')!;
  if (second.status !== 'feedback') throw new Error('Expected feedback');
  workspace.store.acknowledge(plan.session, second.receipt);
  await expect(review.frame.locator('[data-humagent-id="brief"]')).toHaveText(
    secondOriginal!,
  );
});

test('outside clicks focus, then discard, reset after typing, and never trigger another annotation or Send', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.addComment('h1', 'Saved comment');
  await review.frame.locator('.marker').click();
  const note = review.frame.getByLabel('Comment', { exact: true });
  await note.fill('First edit');
  const outside = () =>
    review.frame.locator('h2').first().dispatchEvent('click');
  await outside();
  await expect(note).toBeFocused();
  await expect(note).toHaveValue('First edit');
  await note.fill('Second edit');
  await outside();
  await expect(note).toHaveValue('Second edit');
  await outside();
  await expect(
    review.frame.getByRole('dialog', { name: 'Feedback' }),
  ).toBeHidden();
  expect((await review.state()).drafts[0].item.comment).toBe('Saved comment');
  await review.frame.locator('.marker').click();
  await note.fill('Do not send');
  await expect(page.locator('#send')).toBeDisabled();
  await page.locator('#send').dispatchEvent('click');
  await expect(note).toHaveValue('Do not send');
  await page.locator('#send').dispatchEvent('click');
  await expect(
    review.frame.getByRole('dialog', { name: 'Feedback' }),
  ).toBeHidden();
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  await expect(page.locator('#error')).toBeHidden();
});

test('cursor and text edits work in open shadow roots and restore application cursors', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.evaluate(() => {
    const host = document.createElement('section');
    host.id = 'text-host';
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<p id="shadow-text" style="cursor:help">Shadow words here</p>';
    document.body.prepend(host);
  });
  const target = review.frame.locator('#shadow-text');
  await page.locator('#annotate').click();
  await target.hover({ position: { x: 300, y: 5 } });
  await expect
    .poll(() => target.evaluate((el) => getComputedStyle(el).cursor))
    .toContain('data:image/svg+xml');
  await review.evaluate(() => {
    const el = document
      .querySelector('#text-host')!
      .shadowRoot!.querySelector('p')!;
    const range = document.createRange();
    range.setStart(el.firstChild!, 7);
    range.setEnd(el.firstChild!, 12);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    el.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, composed: true }),
    );
  });
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((el) => getComputedStyle(el).cursor)).toBe(
    'text',
  );
  await page.keyboard.type('content');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(target).toHaveText('Shadow content here');
  expect((await review.state()).drafts[0].item.target?.shadowPath).toEqual([
    'section#text-host',
  ]);
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(await target.evaluate((el) => getComputedStyle(el).cursor)).toBe(
    'help',
  );
});

test('mixed formatting remains a comment target and single runs preserve elements and handlers', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.evaluate(() => {
    const el = document.createElement('p');
    el.id = 'formatted';
    el.innerHTML = 'Plain <strong>bold text</strong> tail';
    el.querySelector('strong')!.addEventListener('click', () => {
      el.dataset.clicked = 'yes';
    });
    document.body.prepend(el);
  });
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await review.evaluate(() => {
    const el = document.querySelector('#formatted')!;
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(
    review.frame.getByLabel('Comment', { exact: true }),
  ).toBeVisible();
  await expect(
    review.frame.getByRole('textbox', { name: 'Edit text', exact: true }),
  ).toHaveCount(0);
  await review.frame.getByLabel('Comment', { exact: true }).press('Escape');
  await review.replace('#formatted strong', 'Still bold');
  await page.locator('#annotate').click();
  await review.frame.locator('#formatted strong').click();
  await expect(review.frame.locator('#formatted')).toHaveAttribute(
    'data-clicked',
    'yes',
  );
  await expect(review.frame.locator('#formatted')).toHaveText(
    'Plain Still bold tail',
  );
});

for (const change of ['node', 'element', 'text', 'relocation'])
  test(`application ${change} changes are never overwritten by preview cleanup`, async ({
    page,
    plan: _plan,
    review,
  }) => {
    await review.replace('h1', 'Local preview');
    await review.evaluate((change) => {
      const el = document.querySelector('h1')!;
      if (change === 'node')
        el.replaceChildren(document.createTextNode('Application update'));
      else if (change === 'element') {
        const next = el.cloneNode(false);
        next.textContent = 'Application update';
        el.replaceWith(next);
      } else if (change === 'relocation') {
        const next = document.createElement('h1');
        next.append(el.firstChild!);
        el.replaceWith(next);
      } else el.firstChild!.textContent = 'Application update';
    }, change);
    await expect(review.frame.locator('.marker:visible')).toHaveCount(0);
    await page.locator('#toggle-review').click();
    await expect(page.locator('#drafts')).toContainText('Target unavailable');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(review.frame.locator('h1')).toHaveText(
      change === 'relocation' ? 'Local preview' : 'Application update',
    );
  });

test('newline and IME input do not confirm early, and source revision changes remove previews', async ({
  page,
  plan: _plan,
  review,
  workspace,
}) => {
  const before = await review.frame.locator('h1').textContent();
  await review.replace('h1', 'Preview');
  await review.frame.locator('.marker').click();
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  await editor.fill('Line one');
  await editor.press('End');
  await editor.press('Shift+Enter');
  await page.keyboard.type('Line two');
  await editor.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(editor).toBeVisible();
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  expect((await review.state()).drafts[0].item.replacement?.after).toBe(
    'Line one\nLine two',
  );
  fs.appendFileSync(workspace.file(), '\n<!-- source revision -->');
  await expect(page.locator('#update')).toBeVisible();
  await expect(review.frame.locator('h1')).toHaveText(before!);
  expect((await review.state()).drafts).toHaveLength(1);
  await expect(page.locator('#send')).toBeDisabled();
});
