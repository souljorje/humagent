import { test, expect } from './fixtures.ts';

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
