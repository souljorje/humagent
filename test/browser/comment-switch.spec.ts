import { test, expect } from './fixtures.ts';

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
