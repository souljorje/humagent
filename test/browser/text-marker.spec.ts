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
    await target.click({ position: { x: 40, y: 14 } });
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
    const expectCaret = async (point: { x: number; y: number }) => {
      await expect
        .poll(async () => {
          const box = (await marker.boundingBox())!;
          return { x: box.x, y: box.y };
        })
        .toEqual({ x: Math.round(point.x), y: Math.round(point.y) });
    };
    await expectCaret(firstEnd);
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
    await expectCaret(nextEnd);
    const updated = (await review.state()).drafts[0];
    expect(updated.item.id).toBe(first.item.id);
    expect(updated.marker).not.toEqual(first.marker);
    expect(updated.item.replacement?.before).toBe('Alpha beta gamma');
    await target.evaluate((el) => {
      el.style.width = '180px';
    });
    const reflowed = await target.evaluate((el) => {
      const range = document.createRange();
      range.setStart(el.firstChild!, el.firstChild!.textContent!.length);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.right + 4, y: rect.top + rect.height / 2 - 16 };
    });
    await expectCaret(reflowed);
    await target.evaluate((el) => {
      el.style.width = '';
    });
    await expectCaret(nextEnd);

    // A note-only change keeps the saved endpoint, rather than the marker click.
    await marker.click();
    await review.frame.getByLabel('Comment', { exact: true }).fill('New note');
    await review.frame
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(review.frame.locator('#panel')).toBeHidden();
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
    await expectCaret(middle);
    await page.screenshot({
      path: test.info().outputPath('text-marker.png'),
      animations: 'disabled',
    });

    await marker.click();
    await editor.fill('Line one');
    await editor.press('End');
    await editor.press('Shift+Enter');
    const blankLine = await editor
      .locator('[data-humagent-placeholder]')
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.right + 4, y: rect.top + rect.height / 2 - 16 };
      });
    await review.frame.getByLabel('Comment', { exact: true }).fill('New line');
    await review.frame
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(review.frame.locator('#panel')).toBeHidden();
    expect((await review.state()).drafts[0].item.replacement?.after).toBe(
      'Line one\n',
    );
    await expectCaret(blankLine);

    await marker.click();
    await editor.fill('Alpha beta gamma');
    const beforeDrop = (await editor.textContent())!;
    await editor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await editor.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B');
    await expect(editor.locator('b,strong')).toHaveCount(0);
    await editor.evaluate((el) => {
      const point = document.createRange();
      point.setStart(el.firstChild!, 6);
      point.collapse(true);
      const rect = point.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', 'X');
      dataTransfer.setData('text/html', '<b>X</b>');
      el.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: rect.x,
          clientY: rect.y + rect.height / 2,
          dataTransfer,
        }),
      );
    });
    await expect(editor.locator('b,strong')).toHaveCount(0);
    await editor.press('Enter');
    await expect(editor).toHaveCount(0);
    expect((await review.state()).drafts[0].item.replacement?.after).toBe(
      beforeDrop.slice(0, 6) + 'X' + beforeDrop.slice(6),
    );
  });
