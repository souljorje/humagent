import { test, expect } from './fixtures.ts';

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
