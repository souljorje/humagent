import { test, expect } from './fixtures.ts';

for (const shadow of [false, true])
  test(`text markers align beside the edited line${shadow ? ' in a shadow root' : ''}`, async ({
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
    await review.frame.locator('#edit-target').click();
    const editor = review.frame.getByRole('textbox', {
      name: 'Edit text',
      exact: true,
    });
    await expect(
      review.frame.getByLabel('Comment', { exact: true }),
    ).toHaveAttribute('placeholder', 'Add a comment…');
    await editor.press('Home');
    for (let i = 0; i < 6; i++) await editor.press('ArrowRight');
    await page.keyboard.type('new ');
    const endpoint = async (offset?: number) =>
      editor.evaluate((el, offset) => {
        const range = document.createRange();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let last = walker.nextNode()!;
        for (let next = walker.nextNode(); next; next = walker.nextNode())
          last = next;
        range.setStart(
          offset === undefined ? last : el.firstChild!,
          offset ?? last.textContent!.length,
        );
        range.collapse(false);
        const rect = range.getBoundingClientRect();
        return { x: rect.left, y: rect.top + rect.height / 2 };
      }, offset);
    const expected = await endpoint(10);
    const line = (await editor.boundingBox())!;
    await review.frame
      .getByLabel('Comment', { exact: true })
      .fill('Explain the edit');
    await review.frame
      .getByRole('button', { name: 'Confirm text edit' })
      .click();
    const marker = review.frame.locator('.marker');
    await expect(marker).toBeVisible();
    const firstBox = (await marker.boundingBox())!;
    expect(firstBox.x).toBeCloseTo(line.x + line.width + 8, 0);
    expect(
      Math.abs(firstBox.y + firstBox.height / 2 - expected.y),
    ).toBeLessThanOrEqual(0.5);
    const first = (await review.state()).drafts[0];
    expect(first.item.target?.coordinates).toEqual({
      x: Math.round(expected.x),
      y: Math.round(expected.y),
      space: 'document',
    });
    await marker.click();
    await editor.fill('A longer replacement that wraps onto another line');
    await editor.press('End');
    await page.keyboard.type('!');
    const next = await endpoint();
    await review.frame
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(review.frame.locator('#panel')).toBeHidden();
    const nextBox = (await marker.boundingBox())!;
    expect(nextBox.x).toBeCloseTo(next.x + 8, 0);
    expect(
      Math.abs(nextBox.y + nextBox.height / 2 - next.y),
    ).toBeLessThanOrEqual(0.5);
    expect((await review.state()).drafts[0].item.id).toBe(first.item.id);
    if (!shadow) {
      await page.reload();
      await review.ready();
      const persisted = (await review.state()).drafts[0];
      expect(persisted.marker).not.toEqual(first.marker);
      expect(persisted.item.replacement?.before).toBe('Alpha beta gamma');
    }
  });
