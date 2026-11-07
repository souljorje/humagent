import { test, expect } from './fixtures.ts';

for (const shadow of [false, true])
  test(`text markers follow the final caret${shadow ? ' in a shadow root' : ''}`, async ({
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
    const caret = (offset?: number) =>
      editor.evaluate((el, offset) => {
        const range = document.createRange();
        const node = el.firstChild!;
        range.setStart(node, offset ?? node.textContent!.length);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        return { x: rect.right + 4, y: rect.top + rect.height / 2 - 16 };
      }, offset);
    const firstEnd = await caret();
    await review.frame
      .getByLabel('Comment', { exact: true })
      .fill('Explain the edit');
    await review.frame
      .getByRole('button', { name: 'Confirm text edit' })
      .click();
    const marker = review.frame.locator('.marker');
    await expect(marker).toBeVisible();
    const firstBox = (await marker.boundingBox())!;
    expect(firstBox.x).toBe(Math.round(firstEnd.x));
    expect(firstBox.y).toBe(Math.round(firstEnd.y));
    const first = (await review.state()).drafts[0];
    expect(first.item.target?.coordinates).toEqual({
      ...point,
      space: 'document',
    });
    await marker.click();
    await editor.fill('A longer replacement that wraps onto another line');
    const nextEnd = await caret();
    await review.frame
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(review.frame.locator('#panel')).toBeHidden();
    const nextBox = (await marker.boundingBox())!;
    expect(nextBox.x).toBe(Math.round(nextEnd.x));
    expect(nextBox.y).toBe(Math.round(nextEnd.y));
    const updated = (await review.state()).drafts[0];
    expect(updated.item.id).toBe(first.item.id);
    expect(updated.marker).not.toEqual(first.marker);
    expect(updated.item.replacement?.before).toBe('Alpha beta gamma');

    // A note-only change keeps the saved endpoint, rather than the marker click.
    await marker.click();
    await review.frame.getByLabel('Comment', { exact: true }).fill('New note');
    await review.frame
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    expect((await review.state()).drafts[0].marker).toEqual(updated.marker);

    // Editing a word in the middle anchors to that caret, not the whole run's end.
    await marker.click();
    await editor.evaluate((el) => {
      const range = document.createRange();
      range.setStart(el.firstChild!, 2);
      range.setEnd(el.firstChild!, 8);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await page.keyboard.type('short');
    const middle = await caret(7);
    await editor.press('Enter');
    await expect(review.frame.locator('#panel')).toBeHidden();
    const middleBox = (await marker.boundingBox())!;
    expect(middleBox.x).toBe(Math.round(middle.x));
    expect(middleBox.y).toBe(Math.round(middle.y));
    await page.screenshot({
      path: test.info().outputPath('text-marker.png'),
      animations: 'disabled',
    });
  });
