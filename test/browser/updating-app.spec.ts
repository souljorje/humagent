import { test, expect } from './fixtures.ts';

test('commenting makes text selectable even where the page blocks selection', async ({
  page,
  plan: _plan,
  review,
}) => {
  const annotate = page.locator('#annotate');
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'true');
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'false');
  await review.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button style="user-select:none"><span id="mode-words">Select this text</span></button>',
    );
  });
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      review.frame
        .locator('#mode-words')
        .evaluate((el) => getComputedStyle(el).userSelect),
    )
    .toBe('text');
});

test('frequent app updates keep annotations attached and new text editable', async ({
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'Keep this attached');
  await review.evaluate(async () => {
    const ticker = document.createElement('p');
    document.body.append(ticker);
    for (let i = 0; i < 50; i++) {
      ticker.textContent = `Update ${i}`;
      ticker.className = `tick-${i % 2}`;
      if (i === 10)
        document.body.insertAdjacentHTML(
          'beforeend',
          '<p id="busy-words" style="position:fixed;left:40px;top:300px;font:20px monospace">New plain text</p>',
        );
      await new Promise(requestAnimationFrame);
    }
  });
  await expect(review.frame.locator('.marker')).toHaveCount(1);
  await review.frame.locator('.marker').click();
  await expect(review.note).toHaveValue('Keep this attached');
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await review.frame.locator('#busy-words').click();
  await expect(review.editor).toBeFocused();
});
