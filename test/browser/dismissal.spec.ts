import { test, expect } from './fixtures.ts';

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
    const input = review.frame.getByLabel('Comment', { exact: true });
    await input.fill('Unconfirmed comment');
    const point = surface === 'html' ? { x: 5, y: 5 } : { x: 15, y: 310 };
    expect(
      await review.evaluate(
        (point) => document.elementFromPoint(point.x, point.y)?.tagName,
        point,
      ),
    ).toBe(surface === 'element' ? 'DIV' : surface.toUpperCase());
    await page.mouse.click(point.x, point.y);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Unconfirmed comment');
    await expect(page.locator('#send')).toBeDisabled();
    await input.fill('Typing resets dismissal');
    await page.mouse.click(point.x, point.y);
    await expect(input).toHaveValue('Typing resets dismissal');
    await page.mouse.click(point.x, point.y);
    await expect(review.frame.getByRole('dialog')).toBeHidden();
    expect((await review.state()).drafts[0].item.comment).toBe('Saved comment');
    expect((await review.state()).drafts).toHaveLength(1);
    expect(workspace.store.get(plan.session).events).toHaveLength(0);
  });
