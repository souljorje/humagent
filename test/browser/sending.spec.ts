import { test, expect } from './fixtures.ts';

test('sending requires an agent and confirmation stays in the button briefly', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const send = page.locator('#send');
  await page.locator('#message').fill('Review this');
  await expect(send).toBeDisabled();
  await send.dispatchEvent('click');
  await expect(page.locator('#error')).toContainText('Connect an agent');
  expect((await review.state()).outbox).toHaveLength(0);
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  await review.connect();
  await expect(send).toBeEnabled();
  let release!: () => void, seen!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    seen = resolve;
  });
  let requests = 0;
  await page.route(`**/api/sessions/${plan.session}/events`, async (route) => {
    requests++;
    seen();
    await gate;
    await route.continue();
  });
  try {
    await send.click();
    await requested;
    await expect(send).toBeDisabled();
    await expect(send).toHaveText('Sending…');
    await send.dispatchEvent('click');
    expect(requests).toBe(1);
    await page.locator('#message').fill('Added while sending');
  } finally {
    release();
  }
  await expect(send).toHaveText('Sent');
  await expect(page.locator('#message')).toHaveValue('Added while sending');
  await expect(send).toHaveText('Send', { timeout: 3000 });
  await page.reload();
  await review.ready();
  await expect(send).toHaveText('Send');
  await expect(page.locator('#activity')).toHaveCount(0);
  await page.locator('#message').fill('More feedback while working');
  await expect(send).toBeEnabled();
  const received = await review.receive();
  workspace.store.acknowledge(plan.session, received.receipt);
  await expect(page.locator('#agent-state')).toHaveText('No agent waiting');
  await expect(send).toBeDisabled();
});

test('disconnect between the browser check and server acceptance retains feedback', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await page.locator('#message').fill('Keep this feedback');
  await review.connect(120000, 1200);
  await page.route(`**/api/sessions/${plan.session}/events`, async (route) => {
    await expect
      .poll(
        async () =>
          (await workspace.api(`/api/sessions/${plan.session}`)).agent,
      )
      .toBe('idle');
    await route.continue();
  });
  await page.locator('#send').click();
  await expect(page.locator('#error')).toContainText('AGENT_UNAVAILABLE');
  await expect(page.locator('#send')).toHaveText('Send');
  await expect(page.locator('#send')).toBeDisabled();
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  await expect(
    page.getByRole('button', { name: 'Return to drafts' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Return to drafts' }).click();
  await expect(page.locator('#message')).toHaveValue('Keep this feedback');
});

test('new feedback immediately restores Send after a confirmed submission', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.locator('#message').fill('First feedback');
  await review.connect();
  await page.locator('#send').click();
  await expect(page.locator('#send')).toHaveText('Sent');
  await page.locator('#message').fill('Next feedback');
  await expect(page.locator('#send')).toHaveText('Send');
  await expect(page.locator('#send')).toBeEnabled();
});
