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
  ).toEqual([
    'agent-indicator',
    'toggle-review',
    'end',
    'annotate',
    'message',
    'send',
  ]);
  expect((await page.locator('#review-bar').boundingBox())!.width).toBe(450);
  const bottom = (await page.locator('.bar-controls').boundingBox())!.y;
  await page.locator('#toggle-review').click();
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
        .locator('.bar-controls')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
});

test('agent presence follows waits and leases independently from delivery', async ({
  page,
  plan,
  workspace,
}) => {
  await page.locator('#toggle-review').click();
  const status = page.locator('#agent-state');
  await expect(status).toHaveText('No agent waiting');
  const wait = workspace.api(`/api/sessions/${plan.session}/wait`, 'POST', {
    timeoutMs: 1200,
  });
  await expect(status).toHaveText('Agent listening');
  await wait;
  await expect(status).toHaveText('No agent waiting');
  await page.locator('#message').fill('Work on this');
  await page.locator('#send').click();
  await expect(page.locator('#activity')).toHaveText('Sent');
  workspace.store.take(plan.session, 'presence-test', 1200);
  await expect(status).toHaveText('Agent working');
  await expect(status).toHaveText('No agent waiting', { timeout: 8000 });
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
  await page.locator('#toggle-review').click();
  const command = `humagent wait ${plan.session} --timeout 50 --lease 600`;
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

test('tooltips explain status and disabled buttons with pointer and keyboard', async ({
  page,
  plan: _plan,
}) => {
  const tip = page.getByRole('tooltip');
  await page.locator('#agent-indicator').hover();
  await expect(tip).toHaveText('No agent waiting');
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
