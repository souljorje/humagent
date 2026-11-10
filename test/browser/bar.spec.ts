import { test, expect } from './fixtures.ts';

test('compact controls, reversible expansion, content growth, and reduced motion', async ({
  page,
  plan: _plan,
}) => {
  expect(
    await page
      .locator('#toggle-review')
      .evaluate((el) => getComputedStyle(el).color),
  ).toBe(
    await page.locator('#end').evaluate((el) => getComputedStyle(el).color),
  );
  expect(
    await page
      .locator('.bar-controls')
      .evaluate((el) =>
        [...el.children].map(
          (child) => child.id || child.firstElementChild?.id,
        ),
      ),
  ).toEqual(['toggle-review', 'annotate', 'message', 'send']);
  expect((await page.locator('#review-bar').boundingBox())!.width).toBe(460);
  expect(
    await page
      .locator('.bar-controls .icon')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width)),
  ).toEqual([42, 42]);
  const bottom = (await page.locator('.bar-controls').boundingBox())!.y;
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.locator('#agent-command')).toBeVisible();
  const positions = await page.evaluate(async () => {
    const toggle = document.getElementById('toggle-review')!;
    const tray = document.getElementById('tray')!;
    const samples: number[] = [];
    for (let i = 0; i < 24; i++) {
      if ([0, 3, 6].includes(i)) toggle.click();
      await new Promise(requestAnimationFrame);
      samples.push(tray.getBoundingClientRect().height);
    }
    return samples;
  });
  expect(
    Math.max(
      ...positions.map((n, i) => (i ? Math.abs(n - positions[i - 1]!) : 0)),
    ),
  ).toBeLessThan(75);
  // The controls return to their place once the tray animation settles.
  await expect
    .poll(async () => (await page.locator('.bar-controls').boundingBox())!.y)
    .toBeCloseTo(bottom, 0);
  await page.locator('#toggle-review').click();
  await expect(page.locator('#tray')).toHaveAttribute('data-expanded', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('#tray')
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe('0s');
  const prior = (await page.locator('#tray').boundingBox())!.height;
  await page.locator('#error').evaluate((el) => {
    (el as HTMLElement).hidden = false;
    el.textContent = 'An actionable error requiring more room. '.repeat(5);
  });
  await expect
    .poll(async () => (await page.locator('#tray').boundingBox())!.height)
    .toBeGreaterThan(prior);
  const width = 390;
  await page.setViewportSize({ width, height: 844 });
  const bar = (await page.locator('#review-bar').boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(8);
  expect(bar.width).toBeLessThanOrEqual(width - 16);
  expect(
    await page
      .locator('.bar-controls .icon')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width)),
  ).toEqual([36, 36]);
  expect(
    await page
      .locator('.bar-controls')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test('agent presence follows waits and receipts independently from delivery', async ({
  page,
  plan,
  workspace,
  review,
}) => {
  const status = page.locator('#agent-state');
  await expect(status).toHaveText('No agent waiting');
  // The request drops after 4 seconds, like an agent that stops waiting.
  // The bar refreshes every second, so it sees the wait before the drop.
  const wait = workspace
    .api(`/api/sessions/${plan.session}/wait`, 'POST', {}, 4000)
    .catch(() => undefined);
  await expect(status).toHaveText('Agent listening');
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await wait;
  await expect(status).toHaveText('No agent waiting');
  await review.expand(false);
  await page.locator('#message').fill('Work on this');
  await review.connect();
  await page.locator('#send').click();
  await expect(page.locator('#send')).toHaveText('Sent');
  const received = await review.receive();
  await expect(status).toHaveText('Agent working');
  workspace.store.acknowledge(plan.session, received.receipt);
  await expect(status).toHaveText('No agent waiting');
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.locator('#activity')).toHaveCount(0);
  const pattern = `**/api/sessions/${plan.session}`;
  await page.route(pattern, (route) => route.abort());
  await expect(status).toHaveText('Connection unavailable', { timeout: 8000 });
  await page.unroute(pattern);
  await expect(status).toHaveText('No agent waiting', { timeout: 8000 });
  await review.expand();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(status).toHaveText('Session ended');
});

test('agent command is session-specific with copy feedback', async ({
  page,
  plan,
}) => {
  const command = `humagent wait ${plan.session}`;
  await expect(page.locator('#agent-command')).toHaveText(command);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          document.body.dataset.copied = value;
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Copy agent command' }).click();
  await expect(page.locator('#copy-status')).toHaveText('Copied');
  await expect(page.locator('#copy-status')).toHaveClass('sr-only');
  await expect(page.locator('#copy-command')).toHaveAttribute(
    'data-copied',
    'true',
  );
  await expect(page.locator('#copy-command')).toHaveText('');
  expect(await page.locator('body').getAttribute('data-copied')).toBe(command);
  await expect(page.locator('#copy-command')).not.toHaveAttribute(
    'data-copied',
    'true',
    { timeout: 2500 },
  );
});

test('tooltips explain disabled buttons with pointer and keyboard', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  const tip = page.getByRole('tooltip');
  await page.locator('#send').hover();
  await expect(tip).toHaveText('Connect an agent to send the review');
  await page.locator('#send').locator('..').focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await page.locator('#toggle-review').click();
  await expect(tip).toBeVisible();
  await expect
    .poll(async () => {
      const tooltip = (await tip.boundingBox())!;
      const button = (await page.locator('#toggle-review').boundingBox())!;
      return Math.abs(tooltip.y + tooltip.height + 8 - button.y);
    })
    .toBeLessThan(1);
  await page.setViewportSize({ width: 320, height: 600 });
  await page.locator('#end').focus();
  await expect(tip).toHaveText('End session');
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(308);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await tip.evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe('0s');
});

test('an initially listening agent starts collapsed and a later stop does not reopen details', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const wait = workspace
    .api(`/api/sessions/${plan.session}/wait`, 'POST', {}, 5000)
    .catch(() => undefined);
  await expect(page.locator('#agent-state')).toHaveText('Agent listening');
  await page.reload();
  await review.ready();
  await expect(page.locator('#agent-state')).toHaveText('Agent listening');
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await wait;
  await expect(page.locator('#agent-state')).toHaveText('No agent waiting');
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

for (const close of ['caret', 'Escape'])
  test(`manual startup collapse through ${close} overrides the idle default`, async ({
    page,
    plan,
    review,
  }) => {
    let release!: () => void, intercepted!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requestSeen = new Promise<void>((resolve) => {
      intercepted = resolve;
    });
    const pattern = `**/api/sessions/${plan.session}`;
    let first = true;
    await page.route(pattern, async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      intercepted();
      await responseGate;
      await route.fulfill({ response });
    });
    await page.reload({ waitUntil: 'commit' });
    await requestSeen;
    try {
      await page.locator('#toggle-review').click();
      await expect(page.locator('#agent-state')).toHaveText(
        'Checking connection',
      );
      if (close === 'caret') await page.locator('#toggle-review').click();
      else await page.keyboard.press('Escape');
      await expect(page.locator('#toggle-review')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    } finally {
      release();
    }
    await review.ready();
    await expect(page.locator('#agent-state')).toHaveText('No agent waiting');
    await expect(page.locator('#toggle-review')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await page.unroute(pattern);
  });
