import fs from 'node:fs';
import { test, expect } from './fixtures.mjs';

test('annotations retain the selected element identity', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await page.locator('[data-mode="annotate"]').click();
  await review.frame.locator('h1').click();
  await page.locator('#message').fill('Keep the headline less prescriptive.');
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(plan.session).events)
    .toHaveLength(1);
  expect(workspace.store.get(plan.session).events[0]).toMatchObject({
    kind: 'annotation',
    payload: {
      target: { id: 'headline' },
      text: 'Keep the headline less prescriptive.',
    },
  });
});

test('exact edit proposals do not write source files', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const source = fs.readFileSync(workspace.file(), 'utf8');
  await page.locator('[data-mode="edit"]').click();
  await review.frame.locator('[data-humagent-id="brief"]').click();
  await page.locator('#replacement').fill('My exact replacement.');
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(plan.session).events)
    .toHaveLength(1);
  expect(workspace.store.get(plan.session).events[0]).toMatchObject({
    kind: 'edit',
    payload: { after: 'My exact replacement.' },
  });
  expect(fs.readFileSync(workspace.file(), 'utf8')).toBe(source);
});

test('control edit guidance clears when the user corrects the selection', async ({
  page,
  review,
}) => {
  await review.open();
  const notice = page.locator('#error');
  const control = review.frame.locator('input[name="outcome"]');
  await page.locator('[data-mode="edit"]').click();
  await control.click();
  await expect(notice).toHaveText(
    'Edit the control through its normal interface, or annotate it instead.',
  );

  await page.locator('[data-mode="interact"]').click();
  await expect(notice).toBeHidden();
  await control.fill('An updated outcome.');
  await expect(control).toHaveValue('An updated outcome.');

  await page.locator('[data-mode="edit"]').click();
  await control.click();
  await expect(notice).toBeVisible();
  await review.frame.locator('h1').click();
  await expect(page.locator('#target-label')).toHaveText('headline');
  await expect(notice).toBeHidden();
});

test('text selections include their exact quote and context', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await page.locator('[data-mode="annotate"]').click();
  await review.frame.locator('h1').click();
  await expect(page.locator('#target')).toBeVisible();
  await review.evaluate(() => {
    const node = document.querySelector('h1').firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 11);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document
      .querySelector('h1')
      .dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.locator('#quote')).toHaveText('Start small');
  await page.locator('#message').fill('Comment on these exact words.');
  await page.locator('#send').click();
  await expect
    .poll(
      () =>
        workspace.store.get(plan.session).events[0]?.payload?.target?.anchor
          ?.quote,
    )
    .toBe('Start small');
});

test('the workspace and page fit desktop and narrow screens', async ({
  page,
  review,
}, testInfo) => {
  await review.open();
  await page.locator('#message').fill('A long review note. '.repeat(80));
  await page.locator('#send').click();
  await expect(page.locator('.entry.human')).toBeVisible();
  await testInfo.attach('desktop', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expect
    .poll(() =>
      review.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await testInfo.attach('mobile', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('stale feedback fails while explicit refresh retains drafts and form values', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.frame
    .locator('input[name="outcome"]')
    .fill('A preserved outcome.');
  await page.locator('[data-mode="annotate"]').click();
  await review.frame.locator('h1').click();
  await page.locator('#message').fill('Preserve this unfinished draft.');
  fs.writeFileSync(
    workspace.file(),
    fs
      .readFileSync(workspace.file(), 'utf8')
      .replace('Start small.', 'Start focused.'),
  );
  await expect(page.locator('#update')).toBeVisible();
  await page.locator('#send').click();
  await expect(page.locator('#error')).toContainText('STALE_REVISION');
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  await page.locator('[data-mode="interact"]').click();
  await expect(page.locator('#error')).toContainText('STALE_REVISION');

  await page.locator('#refresh').click();
  await review.ready();
  await expect(review.frame.locator('h1')).toContainText('Start focused');
  await expect(page.locator('#message')).toHaveValue(
    'Preserve this unfinished draft.',
  );
  await expect(review.frame.locator('input[name="outcome"]')).toHaveValue(
    'A preserved outcome.',
  );
});

test('the frame cannot access the workspace control API', async ({
  review,
  workspace,
}) => {
  await review.open();
  const result = await review.evaluate(async (origin) => {
    try {
      const response = await fetch(origin + '/api/sessions', {
        headers: { 'x-humagent-session': 'guess' },
      });
      return response.status;
    } catch {
      return 'blocked';
    }
  }, workspace.origin);
  expect(['blocked', 401, 403]).toContain(result);
});
