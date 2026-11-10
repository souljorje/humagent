import fs from 'node:fs';
import { test, expect } from './fixtures.ts';

test('acknowledgment preserves same-value application writes', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.replace('h1', 'Application wording');
  await review.connect();
  await page.locator('#send').click();
  await expect(review.frame.locator('.marker')).toHaveCount(0);
  await review.evaluate(() => {
    document.querySelector('h1')!.firstChild!.nodeValue = 'Application wording';
  });
  const received = await review.receive();
  if (received?.status !== 'feedback') throw new Error('Expected feedback');
  workspace.store.acknowledge(plan.session, received.receipt);
  await expect(page.locator('#agent-state')).toHaveText('No agent waiting');
  await expect(review.frame.locator('h1')).toHaveText('Application wording');
});

test('physical clicks on disabled Send dismiss edits without sending', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.replace('h1', 'Saved preview');
  // With an agent listening, a disabled Send proves the bar knows about the open edit.
  await review.connect();
  await expect(page.locator('#send')).toBeEnabled();
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

test('a sent text preview stays after a lost response until acknowledgment', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const original = await review.frame.locator('h1').textContent();
  await review.replace('h1', 'Uncertain preview');
  await page.route(`**/api/sessions/${plan.session}/send`, async (request) => {
    await request.fetch();
    await request.abort();
  });
  await review.connect();
  await page.locator('#send').click();
  await expect(page.locator('#error')).toBeVisible();
  await expect(review.frame.locator('.marker')).toHaveCount(0);
  await expect(review.frame.locator('h1')).toHaveText('Uncertain preview');
  const received = await review.receive();
  workspace.store.acknowledge(plan.session, received.receipt);
  await expect(review.frame.locator('h1')).toHaveText(original!);
  expect(workspace.store.get(plan.session).events).toHaveLength(1);
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
  // The bar shows the edit as a diff: the old word struck through, the new word plain.
  const diff = page.locator('.draft .replacement');
  await expect(diff.locator('del')).toHaveText(
    before.slice(selected.start, selected.end),
  );
  await expect(diff.locator('del')).toHaveCSS(
    'text-decoration-line',
    'line-through',
  );
  await expect(diff.locator('ins')).toHaveText('Better');
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
  await review.connect();
  await page.locator('#send').click();
  await expect(review.frame.locator('.marker')).toHaveCount(0);
  await expect(review.frame.locator('h1')).toHaveText('First preview');
  const first = await review.receive();
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
  await review.connect();
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(plan.session).events.length)
    .toBe(2);
  workspace.store.acknowledge(plan.session, first.receipt);
  await expect(review.frame.locator('h1')).toHaveText(original!);
  await expect(review.frame.locator('[data-humagent-id="brief"]')).toHaveText(
    'Second preview',
  );
  const second = await review.receive();
  if (second.status !== 'feedback') throw new Error('Expected feedback');
  workspace.store.acknowledge(plan.session, second.receipt);
  await expect(review.frame.locator('[data-humagent-id="brief"]')).toHaveText(
    secondOriginal!,
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
    await expect(review.frame.locator('.marker:visible')).toHaveCount(
      change === 'relocation' ? 0 : 1,
    );
    await review.expand();
    if (change === 'relocation')
      await expect(page.locator('.draft-status')).toContainText(
        'Target unavailable',
      );
    else await expect(page.locator('.draft-status')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Delete feedback 1', exact: true })
      .click();
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
