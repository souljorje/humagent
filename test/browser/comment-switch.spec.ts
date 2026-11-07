import { test, expect } from './fixtures.ts';

test('physical bubble presses switch text editors when the page intercepts clicks', async ({
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
  await page.locator('#annotate').click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const markers = review.frame.locator('.marker');
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  const press = async (index: number) => {
    const box = (await markers.nth(index).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await press(1);
  await expect(markers.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(editor).toHaveText('Second saved wording');
  await editor.fill('Unconfirmed wording');
  await press(0);
  await expect(markers.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(markers.nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(editor).toHaveText('First saved wording');
  await expect(review.frame.locator('h1')).toHaveText('Second saved wording');
  await press(1);
  await expect(editor).toHaveText('Second saved wording');
  await expect(
    review.frame.getByRole('dialog', { name: 'Feedback' }),
  ).toHaveCount(1);
});

for (const textEdit of [false, true])
  test(`saved bubbles replace an unfinished new ${textEdit ? 'text edit' : 'comment'}`, async ({
    plan: _plan,
    review,
  }) => {
    await review.addComment('h2 >> nth=0', 'Saved comment');
    const target = review.frame.locator('h1');
    const before = await target.textContent();
    const box = (await target.boundingBox())!;
    await target.click(
      textEdit ? {} : { position: { x: box.width - 4, y: box.height / 2 } },
    );
    if (textEdit)
      await review.frame
        .getByRole('textbox', { name: 'Edit text', exact: true })
        .fill('Unconfirmed wording');
    await review.frame
      .getByLabel('Comment', { exact: true })
      .fill('Unconfirmed comment');
    await review.frame.locator('.marker').click();
    await expect(
      review.frame.getByLabel('Comment', { exact: true }),
    ).toHaveValue('Saved comment');
    await expect(review.frame.locator('.marker')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(target).toHaveText(before!);
    expect((await review.state()).drafts).toHaveLength(1);
  });

for (const textEdit of [false, true])
  test(`clicking saved bubbles switches the open ${textEdit ? 'text edit' : 'comment'}`, async ({
    plan: _plan,
    review,
  }) => {
    if (textEdit) await review.replace('h1', 'Changed heading');
    else await review.addComment('h1', 'First comment');
    await review.addComment('h2 >> nth=0', 'Second comment');
    const markers = review.frame.locator('.marker');
    await markers.nth(0).click();
    await expect(markers.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await review.frame
      .getByLabel('Comment', { exact: true })
      .fill('Unconfirmed edit');
    await markers.nth(1).click();
    await expect(markers.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(markers.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(
      review.frame.getByLabel('Comment', { exact: true }),
    ).toHaveValue('Second comment');
    await markers.nth(0).click();
    await expect(markers.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(markers.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(
      review.frame.getByLabel('Comment', { exact: true }),
    ).toHaveValue(textEdit ? '' : 'First comment');
  });
