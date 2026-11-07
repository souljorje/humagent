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
    workspace.store.get(plan.session).events[0].payload.items[0],
  ).not.toHaveProperty('marker');
  expect(
    workspace.store.get(plan.session).events[0].payload.items[0].target
      ?.coordinates,
  ).toEqual(coordinates);
});

test('markers preserve their click positions without automatic offsets', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await review.expand(false);
  await page.locator('#annotate').click();
  const target = review.frame.locator('h1');
  const size = (await target.boundingBox())!;
  for (const [index, comment] of [
    'First comment',
    'Second comment',
  ].entries()) {
    await target.click({
      position: { x: size.width - 45 - index * 8, y: size.height / 2 },
    });
    await review.frame.getByLabel('Comment', { exact: true }).fill(comment);
    await review.frame
      .getByRole('button', { name: 'Add comment', exact: true })
      .click();
  }
  const markers = review.frame.locator('.marker');
  await expect(markers).toHaveCount(2);
  const a = (await markers.nth(0).boundingBox())!,
    b = (await markers.nth(1).boundingBox())!;
  expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBe(8);
  await markers.nth(1).click();
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  expect((await markers.nth(1).boundingBox())!.x).toBe(b.x);
});

for (const shadow of [false, true])
  test(`button labels edit without activation${shadow ? ' inside shadow roots' : ''}`, async ({
    page,
    plan: _plan,
    review,
  }) => {
    await review.expand(false);
    await review.evaluate((shadow) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:50px;top:40px;width:500px';
      document.body.prepend(host);
      const root = shadow ? host.attachShadow({ mode: 'open' }) : host;
      root.innerHTML =
        '<form><button id="edit-button" style="font:24px monospace;padding:24px;cursor:pointer;user-select:none"><span id="button-label">Alpha beta gamma</span></button></form>';
      document.body.dataset.activations = '0';
      document.body.dataset.presses = '0';
      const activated = (event: Event) => {
        event.preventDefault();
        document.body.dataset.activations = String(
          Number(document.body.dataset.activations) + 1,
        );
      };
      root.querySelector('button')!.addEventListener('click', activated);
      for (const type of ['mousedown', 'pointerup'])
        root.querySelector('button')!.addEventListener(type, () => {
          document.body.dataset.presses = String(
            Number(document.body.dataset.presses) + 1,
          );
        });
      root.querySelector('form')!.addEventListener('submit', activated);
    }, shadow);
    await page.locator('#annotate').click();
    const button = review.frame.locator('#edit-button'),
      label = review.frame.locator('#button-label');
    await button.hover({ position: { x: 5, y: 5 } });
    await expect
      .poll(() => button.evaluate((el) => getComputedStyle(el).cursor))
      .toContain('data:image/svg+xml');
    await label.hover();
    await expect
      .poll(() => label.evaluate((el) => getComputedStyle(el).cursor))
      .toBe('text');
    await label.click();
    const editor = review.frame.getByRole('textbox', {
      name: 'Edit text',
      exact: true,
    });
    await expect(editor).toBeFocused();
    await editor.fill('New label');
    await editor.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    expect(await review.evaluate(() => document.body.dataset.activations)).toBe(
      '0',
    );
    await editor.press('Escape');
    await expect(label).toHaveText('Alpha beta gamma');
    const bounds = (await label.boundingBox())!;
    await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 65, bounds.y + bounds.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
    await expect(editor).toBeFocused();
    await page.keyboard.type('Changed');
    await review.frame
      .getByLabel('Comment', { exact: true })
      .fill('Clearer label');
    await review.frame
      .getByRole('button', { name: 'Confirm text edit' })
      .click();
    await expect(review.frame.locator('#panel')).toBeHidden();
    expect((await review.state()).drafts[0].item).toMatchObject({
      comment: 'Clearer label',
      replacement: { before: 'Alpha beta gamma' },
    });
    expect(await review.evaluate(() => document.body.dataset.presses)).toBe(
      '0',
    );
    expect(await review.evaluate(() => document.body.dataset.activations)).toBe(
      '0',
    );
    await page.locator('#annotate').click();
    await expect(page.locator('#annotate')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect
      .poll(() => button.evaluate((el) => getComputedStyle(el).cursor))
      .toBe('pointer');
    await button.click({ position: { x: 5, y: 5 } });
    expect(await review.evaluate(() => document.body.dataset.activations)).toBe(
      '1',
    );
  });
