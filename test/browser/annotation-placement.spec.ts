import { test, expect } from './fixtures.ts';

test('markers retain the click position across editing, reload, and scrolling', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await review.expand(false);
  await page.locator('#annotate').click();
  const target = review.frame.locator('h1');
  const bounds = (await target.boundingBox())!;
  const coordinates = {
    x: Math.round(bounds.x + 30),
    y: Math.round(bounds.y + 20),
    space: 'document',
  };
  await target.click({ position: { x: 30, y: 20 } });
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Keep the marker here');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
  const marker = review.frame.locator('.marker');
  await expect(marker).toBeVisible();
  const first = (await marker.boundingBox())!;
  expect(first.x).toBeCloseTo(coordinates.x, 0);
  expect(first.y).toBeCloseTo(coordinates.y, 0);
  const draft = (await review.state()).drafts[0];
  expect(draft.marker).toBeDefined();
  await marker.click();
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Updated comment');
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
    .poll(async () => (await marker.boundingBox())!.x + 32)
    .toBeLessThanOrEqual(308);
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
  await annotate.click();
  await button.hover({ position: { x: 5, y: 5 } });
  await expect.poll(() => cursor(button)).toBe('pointer');
  await label.hover();
  await expect.poll(() => cursor(label)).toBe('pointer');
  await label.click();
  const editor = review.frame.getByRole('textbox', {
    name: 'Edit text',
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.fill('New label');
  await editor.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  expect(await activations()).toBe('0');
  await editor.press('Escape');
  await expect(label).toHaveText('Alpha beta gamma');
  const bounds = (await label.boundingBox())!;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 65, y, { steps: 10 });
  await page.mouse.up();
  await expect(editor).toBeFocused();
  await page.keyboard.type('Changed');
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Clearer label');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
  await expect(review.frame.locator('#panel')).toBeHidden();
  expect((await review.state()).drafts[0].item).toMatchObject({
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
