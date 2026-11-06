import { test, expect } from './fixtures.ts';

test('compact controls, reversible expansion, content growth, and reduced motion', async ({
  page,
  plan: _plan,
}) => {
  expect(
    await page
      .locator('.bar-controls')
      .evaluate((el) =>
        [...el.children].map(
          (child) => child.id || child.firstElementChild?.id,
        ),
      ),
  ).toEqual(['end', 'toggle-review', 'annotate', 'message', 'send']);
  expect((await page.locator('#review-bar').boundingBox())!.width).toBe(450);
  expect(
    await page
      .locator('.bar-controls .icon')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width)),
  ).toEqual([42, 42, 42]);
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
  expect((await page.locator('.bar-controls').boundingBox())!.y).toBeCloseTo(
    bottom,
    0,
  );
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
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bar = (await page.locator('#review-bar').boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(8);
    expect(bar.width).toBeLessThanOrEqual(width - 16);
    expect(
      await page
        .locator('.bar-controls .icon')
        .evaluateAll((els) =>
          els.map((el) => el.getBoundingClientRect().width),
        ),
    ).toEqual([36, 36, 36]);
    expect(
      await page
        .locator('.bar-controls')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
});

test('agent presence follows waits and leases independently from delivery', async ({
  page,
  plan,
  workspace,
  review,
}) => {
  const status = page.locator('#agent-state');
  await expect(status).toHaveText('No agent waiting');
  const wait = workspace.api(`/api/sessions/${plan.session}/wait`, 'POST', {
    timeoutMs: 1200,
  });
  await expect(status).toHaveText('Agent listening');
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await wait;
  await expect(status).toHaveText('No agent waiting');
  await review.expand(false);
  await page.locator('#message').fill('Work on this');
  await page.locator('#send').click();
  await expect(page.locator('#activity')).toHaveText('Sent');
  workspace.store.take(plan.session, 'presence-test', 1200);
  await expect(status).toHaveText('Agent working');
  await expect(status).toHaveText('No agent waiting', { timeout: 8000 });
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.locator('#activity')).toHaveText('Working');
  const pattern = `**/api/sessions/${plan.session}`;
  await page.route(pattern, (route) => route.abort());
  await expect(status).toHaveText('Connection unavailable', { timeout: 8000 });
  await page.unroute(pattern);
  await expect(status).toHaveText('No agent waiting', { timeout: 8000 });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(status).toHaveText('Session ended');
});

test('agent command is session-specific with copy feedback and selectable fallback', async ({
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
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Denied');
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Copy agent command' }).click();
  await expect(page.locator('#copy-status')).toHaveText(
    'Select and copy the command.',
  );
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(command);
});

test('tooltips explain disabled buttons with pointer and keyboard', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  const tip = page.getByRole('tooltip');
  await page.locator('#send').hover();
  await expect(tip).toHaveText('Send feedback to your agent');
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

test('pending counts and the decorative agent dot stay inside expanded details', async ({
  page,
  plan: _plan,
  review,
}) => {
  const dot = page.locator('#agent-indicator');
  await expect(dot).toHaveAttribute('aria-hidden', 'true');
  expect(await dot.getAttribute('tabindex')).toBeNull();
  await expect(page.locator('.bar-controls #agent-indicator')).toHaveCount(0);
  await expect(page.locator('.agent-status #agent-state')).toHaveText(
    'No agent waiting',
  );
  const dotBox = (await dot.boundingBox())!;
  const statusBox = (await page.locator('#agent-state').boundingBox())!;
  expect(statusBox.x - dotBox.x - dotBox.width).toBe(6);
  await expect(page.locator('#pending-count')).toBeHidden();
  await review.addComment('h1', 'Pending feedback');
  await expect(page.locator('#pending-count')).toHaveText(
    'Pending feedback (1)',
  );
  await expect(page.locator('#toggle-review')).toHaveText('');
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'data-tooltip',
    'Review details',
  );
  expect((await page.locator('#toggle-review').boundingBox())!.width).toBe(42);
  await review.expand(false);
  await expect(page.locator('#pending-count')).not.toBeInViewport();
  await review.frame.locator('.marker').click();
  await review.frame.getByRole('button', { name: 'Delete comment' }).click();
  await review.expand();
  await expect(page.locator('#pending-count')).toBeHidden();
});

test('an initially listening agent starts collapsed and a later timeout does not reopen details', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const wait = workspace.api(`/api/sessions/${plan.session}/wait`, 'POST', {
    timeoutMs: 5000,
  });
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

test('an initially working agent starts collapsed', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await page.locator('#message').fill('Prepare the next change');
  await page.locator('#send').click();
  await expect(page.locator('#activity')).toHaveText('Sent');
  workspace.store.take(plan.session, 'initially-working', 60000);
  await page.reload();
  await review.ready();
  await expect(page.locator('#agent-state')).toHaveText('Agent working');
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
