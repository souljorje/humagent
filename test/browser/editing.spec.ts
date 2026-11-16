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
      .evaluate((el) => el.getAnimations().length > 0),
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

test('a selected text comment omits a no-op replacement', async ({
  plan: _plan,
  review,
}) => {
  await review.annotate();
  await review.selectText('h1');
  await expect(review.editor).toBeFocused();
  await expect(
    review.frame.getByRole('button', { name: 'Confirm text edit' }),
  ).toBeDisabled();
  await review.note.fill('Keep the wording; change its emphasis.');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
  await expect(review.editor).toHaveCount(0);
  const item = await review.draft();
  expect(item.comment).toBe('Keep the wording; change its emphasis.');
  expect(item.replacement).toBeUndefined();
});

test('Enter confirms comments and edits while Shift+Enter preserves line breaks', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  await review.annotate();
  const target = review.frame.locator('h1');
  const bounds = (await target.boundingBox())!;
  await target.click({
    position: { x: bounds.width - 4, y: bounds.height / 2 },
  });
  await review.note.press('Enter');
  await expect(review.note).toBeVisible();
  expect((await review.state()).drafts).toHaveLength(0);
  await review.note.fill('First line');
  await review.note.press('End');
  await review.note.press('Shift+Enter');
  await page.keyboard.type('Second line');
  await review.note.dispatchEvent('keydown', {
    key: 'Enter',
    isComposing: true,
  });
  await expect(review.note).toBeVisible();
  await review.note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  const saved = (await review.state()).drafts[0];
  expect(saved.item.comment).toBe('First line\nSecond line');
  await review.frame.locator('.marker').click();
  await review.note.fill('Updated');
  await review.note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  expect(await review.draft()).toMatchObject({
    id: saved.item.id,
    comment: 'Updated',
  });
  await review.frame.locator('.marker').click();
  await review.note.press('Enter');
  await expect(review.note).toBeVisible();
  await review.note.press('Escape');
});

test('physical bubble presses switch text editors and replace unfinished edits when the page intercepts clicks', async ({
  page,
  review,
  workspace,
}) => {
  await page.addInitScript(() => {
    document.addEventListener(
      'click',
      (event) => {
        if (
          event
            .composedPath()
            .some((node) => node instanceof Element && node.matches('.marker'))
        )
          event.stopImmediatePropagation();
      },
      true,
    );
  });
  await review.open(workspace.file('existing.html'));
  await review.replace('h2', 'First saved wording');
  await review.replace('h1', 'Second saved wording');
  const annotate = page.locator('#annotate');
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'false');
  const markers = review.frame.locator('.marker');
  const press = async (index: number) => {
    const box = (await markers.nth(index).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await press(1);
  await expect(markers.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(review.editor).toHaveText('Second saved wording');
  await review.editor.fill('Unconfirmed wording');
  await press(0);
  await expect(markers.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(markers.nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(review.editor).toHaveText('First saved wording');
  await expect(review.frame.locator('h1')).toHaveText('Second saved wording');
  await press(1);
  await expect(review.editor).toHaveText('Second saved wording');
  await expect(
    review.frame.getByRole('dialog', { name: 'Feedback' }),
  ).toHaveCount(1);
  // A saved bubble also replaces an unfinished new text edit.
  await review.editor.press('Escape');
  await review.addComment('.card p', 'Saved comment');
  const counter = review.frame.locator('#counter');
  await counter.click();
  await review.editor.fill('Unconfirmed wording');
  await review.note.fill('Unconfirmed comment');
  await press(2);
  await expect(review.note).toHaveValue('Saved comment');
  await expect(markers.nth(2)).toHaveAttribute('aria-expanded', 'true');
  await expect(counter).toHaveText('Count: 0');
  expect((await review.state()).drafts).toHaveLength(3);
});

for (const [enabled, surface] of [
  [true, 'element'],
  [false, 'html'],
] as const)
  test(`outside ${surface} clicks dismiss saved edits with commenting ${enabled ? 'on' : 'off'}`, async ({
    page,
    plan,
    review,
    workspace,
  }) => {
    await review.evaluate(() => {
      document.body.style.margin = '80px';
      document.body.style.padding = '50px';
      const outside = document.createElement('div');
      outside.id = 'outside-surface';
      outside.style.cssText =
        'position:fixed;left:4px;top:300px;width:40px;height:40px';
      outside.textContent = 'Box';
      document.body.append(outside);
    });
    await review.addComment('h1', 'Saved comment');
    if (!enabled) await page.locator('#annotate').click();
    await expect(page.locator('#annotate')).toHaveAttribute(
      'aria-pressed',
      String(enabled),
    );
    await review.frame.locator('.marker').click();
    await review.note.fill('Unconfirmed comment');
    const point = surface === 'html' ? { x: 5, y: 5 } : { x: 15, y: 310 };
    expect(
      await review.evaluate(
        (point) => document.elementFromPoint(point.x, point.y)?.tagName,
        point,
      ),
    ).toBe(surface === 'element' ? 'DIV' : surface.toUpperCase());
    await page.mouse.click(point.x, point.y);
    await expect(review.note).toBeFocused();
    await expect(review.note).toHaveValue('Unconfirmed comment');
    await expect(page.locator('#send')).toBeDisabled();
    await review.note.fill('Typing resets dismissal');
    await page.mouse.click(point.x, point.y);
    await expect(review.note).toHaveValue('Typing resets dismissal');
    await page.mouse.click(point.x, point.y);
    await expect(review.frame.getByRole('dialog')).toBeHidden();
    expect((await review.draft()).comment).toBe('Saved comment');
    expect((await review.state()).drafts).toHaveLength(1);
    expect(workspace.store.get(plan.session).events).toHaveLength(0);
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
  await review.editor.fill('Unconfirmed edit');
  await expect(page.locator('#send')).toBeDisabled();
  const box = (await page.locator('#send').boundingBox())!;
  const click = () =>
    page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await click();
  await expect(review.editor).toBeFocused();
  await expect(review.editor).toHaveText('Unconfirmed edit');
  await click();
  await expect(review.editor).toHaveCount(0);
  await expect(review.frame.locator('h1')).toHaveText('Saved preview');
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
});
