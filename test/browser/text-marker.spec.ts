import { test, expect } from './fixtures.ts';

for (const shadow of [false, true])
  test(`text markers stay at the original click${shadow ? ' in a shadow root' : ''}`, async ({
    page,
    plan: _plan,
    review,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await review.expand(false);
    await review.evaluate((shadow) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:80px;top:120px;width:300px';
      const root = shadow ? host.attachShadow({ mode: 'open' }) : host;
      root.innerHTML =
        '<p id="edit-target" style="font:20px/1.5 monospace;white-space:pre-wrap">Alpha beta gamma</p>';
      document.body.prepend(host);
    }, shadow);
    await page.locator('#annotate').click();
    const target = review.frame.locator('#edit-target');
    const bounds = (await target.boundingBox())!;
    const point = {
      x: Math.round(bounds.x + 40),
      y: Math.round(bounds.y + 14),
    };
    await page.mouse.click(point.x, point.y);
    const editor = review.frame.getByRole('textbox', {
      name: 'Edit text',
      exact: true,
    });
    await expect(
      review.frame.getByLabel('Comment', { exact: true }),
    ).toHaveAttribute('placeholder', 'Add a comment…');
    await editor.fill('Changed wording');
    await review.frame
      .getByLabel('Comment', { exact: true })
      .fill('Explain the edit');
    await review.frame
      .getByRole('button', { name: 'Confirm text edit' })
      .click();
    const marker = review.frame.locator('.marker');
    await expect(marker).toBeVisible();
    const firstBox = (await marker.boundingBox())!;
    expect(firstBox.x).toBe(point.x);
    expect(firstBox.y).toBe(point.y);
    const first = (await review.state()).drafts[0];
    expect(first.item.target?.coordinates).toEqual({
      ...point,
      space: 'document',
    });
    await marker.click();
    await editor.fill('A longer replacement that wraps onto another line');
    await review.frame
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(review.frame.locator('#panel')).toBeHidden();
    const nextBox = (await marker.boundingBox())!;
    expect(nextBox.x).toBe(point.x);
    expect(nextBox.y).toBe(point.y);
    const updated = (await review.state()).drafts[0];
    expect(updated.item.id).toBe(first.item.id);
    expect(updated.marker).toEqual(first.marker);
    expect(updated.item.replacement?.before).toBe('Alpha beta gamma');
  });
