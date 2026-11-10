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
  const annotate = page.locator('#annotate');
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'false');
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

test('saved bubbles replace an unfinished new text edit', async ({
  plan: _plan,
  review,
}) => {
  await review.addComment('h2 >> nth=0', 'Saved comment');
  const target = review.frame.locator('h1');
  const before = await target.textContent();
  const comment = review.frame.getByLabel('Comment', { exact: true });
  await target.click();
  await review.frame
    .getByRole('textbox', { name: 'Edit text', exact: true })
    .fill('Unconfirmed wording');
  await comment.fill('Unconfirmed comment');
  await review.frame.locator('.marker').click();
  await expect(comment).toHaveValue('Saved comment');
  await expect(review.frame.locator('.marker')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(target).toHaveText(before!);
  expect((await review.state()).drafts).toHaveLength(1);
});
