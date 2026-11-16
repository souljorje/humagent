import { test, expect } from './fixtures.ts';

test('markers retain the click position across editing, reload, and scrolling', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await review.expand(false);
  await review.annotate();
  const target = review.frame.locator('h1');
  const bounds = (await target.boundingBox())!;
  const coordinates = {
    x: Math.round(bounds.x + 30),
    y: Math.round(bounds.y + 20),
    space: 'document',
  };
  await target.click({ position: { x: 30, y: 20 } });
  await review.note.fill('Keep the marker here');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
  const marker = review.frame.locator('.marker');
  await expect(marker).toBeVisible();
  const first = (await marker.boundingBox())!;
  expect(first.x).toBeCloseTo(coordinates.x, 0);
  expect(first.y).toBeCloseTo(coordinates.y, 0);
  const draft = (await review.state()).drafts[0];
  expect(draft.marker).toBeDefined();
  await marker.click();
  await review.note.fill('Updated comment');
  await review.frame.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await review.state()).drafts[0].marker).toEqual(draft.marker);
  expect((await marker.boundingBox())!.x).toBeCloseTo(first.x, 0);
  await page.reload();
  await review.ready();
  await expect(marker).toBeVisible();
  expect((await marker.boundingBox())!.x).toBeCloseTo(first.x, 0);
  const beforeScroll = (await marker.boundingBox())!;
  await review.evaluate(() => {
    document.body.style.minHeight = '1800px';
    scrollTo(0, 20);
  });
  await expect
    .poll(async () => (await marker.boundingBox())!.y)
    .toBeCloseTo(beforeScroll.y - 20, 0);
  await page.setViewportSize({ width: 320, height: 600 });
  await expect
    .poll(async () => {
      const box = (await marker.boundingBox())!;
      return box.x + box.width;
    })
    .toBeLessThanOrEqual(320);
  await review.connect();
  await page.locator('#send').click();
  await expect(marker).toHaveCount(0);
  expect(
    workspace.store.get(plan.session).events[0].items[0],
  ).not.toHaveProperty('marker');
  expect(
    workspace.store.get(plan.session).events[0].items[0].target?.coordinates,
  ).toEqual(coordinates);
});

test('button labels edit without activation', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  await review.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:50px;top:40px;width:500px';
    document.body.prepend(host);
    host.innerHTML =
      '<form><button id="edit-button" style="font:24px monospace;padding:24px;cursor:pointer;user-select:none"><span id="button-label">Alpha beta gamma</span></button></form>';
    const data = document.body.dataset;
    data.activations = data.presses = '0';
    const activated = (event: Event) => {
      event.preventDefault();
      data.activations = String(Number(data.activations) + 1);
    };
    const button = host.querySelector('button')!;
    button.addEventListener('click', activated);
    for (const type of ['mousedown', 'pointerup'])
      button.addEventListener(type, () => {
        data.presses = String(Number(data.presses) + 1);
      });
    host.querySelector('form')!.addEventListener('submit', activated);
  });
  const annotate = page.locator('#annotate');
  const activations = () =>
    review.evaluate(() => document.body.dataset.activations);
  const button = review.frame.locator('#edit-button'),
    label = review.frame.locator('#button-label');
  const cursor = (locator: typeof button) =>
    locator.evaluate((el) => getComputedStyle(el).cursor);
  await review.annotate();
  await button.hover({ position: { x: 5, y: 5 } });
  await expect.poll(() => cursor(button)).toBe('pointer');
  await label.hover();
  await expect.poll(() => cursor(label)).toBe('pointer');
  await label.click();
  await expect(review.editor).toBeFocused();
  await review.editor.fill('New label');
  await review.editor.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  expect(await activations()).toBe('0');
  await review.editor.press('Escape');
  await expect(label).toHaveText('Alpha beta gamma');
  const bounds = (await label.boundingBox())!;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 65, y, { steps: 10 });
  await page.mouse.up();
  await expect(review.editor).toBeFocused();
  await page.keyboard.type('Changed');
  await review.note.fill('Clearer label');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
  await expect(review.frame.locator('#panel')).toBeHidden();
  expect(await review.draft()).toMatchObject({
    comment: 'Clearer label',
    replacement: { before: 'Alpha beta gamma' },
  });
  expect(await review.evaluate(() => document.body.dataset.presses)).toBe('0');
  expect(await activations()).toBe('0');
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => cursor(button)).toBe('pointer');
  await button.click({ position: { x: 5, y: 5 } });
  expect(await activations()).toBe('1');
});

test('feedback rows highlight targets, open editors, and delete independently', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await review.addComment('h1', 'First comment');
  await review.addComment('[data-humagent-id="brief"]', 'Second comment');
  await review.expand();
  const rows = page.locator('.draft');
  const highlight = review.frame.locator('#highlight');
  const markers = review.frame.locator('.marker');
  const firstTarget = (await review.frame.locator('h1').boundingBox())!;
  await rows.nth(0).hover();
  await expect(highlight).toBeVisible();
  await expect(markers.nth(0)).toHaveClass(/highlighted/);
  await expect(markers.nth(1)).not.toHaveClass(/highlighted/);
  await expect
    .poll(async () => (await highlight.boundingBox())!.y)
    .toBeCloseTo(firstTarget.y, 0);
  await rows.nth(0).click({ position: { x: 8, y: 40 } });
  const cancel = review.frame.getByRole('button', {
    name: 'Cancel',
    exact: true,
  });
  await expect(review.note).toHaveValue('First comment');
  await expect(markers.nth(0)).toHaveAttribute('aria-expanded', 'true');
  const panel = (await review.frame.locator('#panel').boundingBox())!;
  const secondTarget = (await review.frame
    .locator('[data-humagent-id="brief"]')
    .boundingBox())!;
  await rows.nth(1).hover();
  await expect(markers.nth(1)).toHaveClass(/highlighted/);
  await expect(markers.nth(0)).not.toHaveClass(/highlighted/);
  await expect
    .poll(async () => (await highlight.boundingBox())!.y)
    .toBeCloseTo(secondTarget.y, 0);
  expect((await review.frame.locator('#panel').boundingBox())!.y).toBeCloseTo(
    panel.y,
    0,
  );
  await expect(review.note).toHaveValue('First comment');
  await page.locator('#message').hover();
  await expect(review.frame.locator('.marker.highlighted')).toHaveCount(0);
  await rows.nth(1).click({ position: { x: 8, y: 40 } });
  await expect(review.note).toHaveValue('Second comment');
  await cancel.click();
  const first = page.getByRole('button', {
    name: 'Edit feedback 1',
    exact: true,
  });
  await first.focus();
  await expect(markers.nth(0)).toHaveClass(/highlighted/);
  await first.press('Enter');
  await expect(review.note).toHaveValue('First comment');
  await cancel.click();
  const id = (await review.draft()).id;
  const trash = page.getByRole('button', {
    name: 'Delete feedback 2',
    exact: true,
  });
  expect((await trash.boundingBox())!.x).toBeGreaterThan(
    (await rows.nth(1).boundingBox())!.x + 300,
  );
  await trash.click();
  await expect(rows).toHaveCount(1);
  await expect(review.frame.locator('#panel')).toBeHidden();
  expect((await review.draft()).id).toBe(id);
});
