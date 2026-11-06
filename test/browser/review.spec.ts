import fs from 'node:fs';
import { test, expect } from './fixtures.ts';

test('replacement text stays protected after switching to Comment', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.frame.locator('h1').click({ button: 'right' });
  await review.frame
    .getByRole('button', { name: 'Suggest replacement' })
    .click();
  await review.frame
    .getByLabel('Exact replacement', { exact: true })
    .fill('Keep this proposed wording');
  await review.frame
    .getByRole('button', { name: 'Comment', exact: true })
    .click();
  const documentId = await review.evaluate(
    () => window.__HUMAGENT__!.documentId,
  );
  await page.locator('#refresh').click();
  await expect(page.locator('#error')).toContainText('Add or cancel');
  expect(await review.evaluate(() => window.__HUMAGENT__!.documentId)).toBe(
    documentId,
  );
  await review.frame
    .getByRole('button', { name: 'Suggest replacement' })
    .click();
  await expect(
    review.frame.getByLabel('Exact replacement', { exact: true }),
  ).toHaveValue('Keep this proposed wording');
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
});

test('unfinished feedback survives reselection and blocks refresh until added or cancelled', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.frame.locator('h1').click({ button: 'right' });
  await review.frame
    .getByRole('button', { name: 'Comment', exact: true })
    .click();
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Keep this unfinished note');
  await review.evaluate(() =>
    document
      .querySelector('[data-humagent-id="brief"]')!
      .dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      ),
  );
  await expect(review.frame.getByLabel('Comment', { exact: true })).toHaveValue(
    'Keep this unfinished note',
  );
  const documentId = await review.evaluate(
    () => window.__HUMAGENT__!.documentId,
  );
  await page.locator('#refresh').click();
  await expect(page.locator('#error')).toContainText(
    'Add or cancel your current feedback',
  );
  expect(await review.evaluate(() => window.__HUMAGENT__!.documentId)).toBe(
    documentId,
  );
  await review.frame.getByRole('button', { name: 'Add to review' }).click();
  await expect(page.locator('.draft')).toHaveCount(1);
  expect((await review.state()).drafts[0].item.target!.id).toBe('headline');
});

test('polling and reordering preserve keyboard focus', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.addComment('h1', 'First');
  await review.addComment('[data-humagent-id="brief"]', 'Second');
  const first = (await review.state()).drafts[0].item.id;
  const down = page
    .locator(`[data-draft-id="${first}"]`)
    .getByRole('button', { name: 'Move down' });
  await down.focus();
  await workspace.api(`/api/sessions/${plan.session}/reply`, 'POST', {
    message: 'Focus check',
  });
  await expect(page.locator('#activity')).toContainText('Focus check');
  await expect(down).toBeFocused();
  const deadline = Date.now() + 3200;
  await expect
    .poll(async () => {
      await expect(down).toBeFocused();
      return Date.now() >= deadline;
    })
    .toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('.draft').last()).toHaveAttribute(
    'data-draft-id',
    first,
  );
  await expect(
    page
      .locator('.draft')
      .last()
      .getByRole('button', { name: 'Edit', exact: true }),
  ).toBeFocused();
});

test('shadow controls retain native context menus', async ({
  plan: _plan,
  review,
}) => {
  expect(
    await review.evaluate(() => {
      const host = document.createElement('div');
      document.body.append(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<input value="Native control">';
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      shadow.querySelector('input')!.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await expect(review.frame.getByRole('dialog')).toBeHidden();
});

test('closing feedback restores focus to SVG controls', async ({
  plan: _plan,
  review,
}) => {
  await review.evaluate(() => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'svg-focus';
    svg.setAttribute('tabindex', '0');
    document.body.append(svg);
    svg.focus();
    document
      .querySelector('h1')!
      .dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
  });
  await expect(review.frame.getByRole('dialog')).toBeVisible();
  await review.frame
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(review.frame.locator('#svg-focus')).toBeFocused();
});

test('several comments and an exact deletion form one ordered review without mutating source', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const source = fs.readFileSync(workspace.file(), 'utf8');
  const original = await review.frame.locator('h1').textContent();
  await review.addComment('h1', 'A shorter heading.');
  await review.addComment(
    '[data-humagent-id="brief"]',
    'Keep these boundaries.',
  );
  await review.replace('h1', '');
  await expect(page.locator('.draft')).toHaveCount(3);
  await expect(review.frame.locator('.marker')).toHaveCount(3);
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  await page.locator('#message').fill('Apply these together.');
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(plan.session).events.length)
    .toBe(1);
  const event = workspace.store.get(plan.session).events[0];
  expect(event.protocol).toBe(2);
  expect(
    event.payload.items.map((item) => item.comment || item.replacement!.after),
  ).toEqual(['A shorter heading.', 'Keep these boundaries.', '']);
  expect(event.payload.items[2].replacement!.before).toBe(original);
  expect(event.payload.items[2].target!.anchor).toMatchObject({
    quote: original,
  });
  expect(event.payload.items[0].target).toMatchObject({
    id: 'headline',
    revision: event.revision,
  });
  expect(await review.frame.locator('h1').textContent()).toBe(original);
  expect(fs.readFileSync(workspace.file(), 'utf8')).toBe(source);
});

test('draft editing and non-drag reordering retain IDs and marker numbers', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'First');
  await review.addComment('[data-humagent-id="brief"]', 'Second');
  const ids = (await review.state()).drafts.map((d) => d.item.id);
  await page
    .locator('.draft')
    .nth(1)
    .getByRole('button', { name: 'Move up' })
    .click();
  expect((await review.state()).drafts.map((d) => d.item.id)).toEqual(
    ids.toReversed(),
  );
  await expect(
    review.frame.locator(`.marker[data-draft-id="${ids[1]}"]`),
  ).toHaveText('1');
  await page
    .locator('.draft')
    .first()
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page.locator('#edit-comment').fill('Changed second');
  await page.getByRole('button', { name: 'Save feedback' }).click();
  await expect(page.locator('.draft').first()).toContainText('Changed second');
  await page
    .locator('.draft')
    .nth(1)
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(review.frame.locator('.marker')).toHaveCount(1);
  await page.reload();
  await review.ready();
  expect((await review.state()).drafts[0].item.id).toBe(ids[1]);
});

test('removed targets remain unavailable instead of binding to replacements', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'Keep my original target');
  await expect(review.frame.locator('.marker')).toHaveCount(1);
  await review.evaluate(() => {
    const h = document.querySelector('h1')!;
    h.replaceWith(h.cloneNode(true));
  });
  await expect(page.locator('.draft-status')).toContainText(
    'Target unavailable',
  );
  await expect(review.frame.locator('.marker')).toHaveCount(0);
});

test('keyboard picker annotates controls once and Escape restores native interaction', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.getByRole('button', { name: 'Annotate', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(review.frame.locator('#picker')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await review.frame
    .getByRole('button', { name: 'Choose', exact: true })
    .press('Enter');
  await expect(review.frame.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(review.frame.getByRole('dialog')).toBeHidden();
  await page.locator('#annotate').click();
  await review.frame.locator('input[name="outcome"]').click();
  await expect(
    review.frame.getByRole('button', { name: 'Suggest replacement' }),
  ).toBeDisabled();
  await review.frame
    .getByRole('button', { name: 'Comment', exact: true })
    .click();
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Review this field');
  await review.frame.getByRole('button', { name: 'Add to review' }).click();
  await review.frame
    .locator('input[name="outcome"]')
    .fill('Native editing still works');
  await expect(review.frame.locator('input[name="outcome"]')).toHaveValue(
    'Native editing still works',
  );
});

test('right-click respects controls and Shift, and double-click retains selected text', async ({
  plan: _plan,
  review,
}) => {
  const results = await review.evaluate(() => {
    const check = (el: Element | null, shiftKey: boolean) => {
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        shiftKey,
      });
      el!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      control: check(document.querySelector('input'), false),
      shifted: check(document.querySelector('h1'), true),
      plain: check(document.querySelector('h1'), false),
    };
  });
  expect(results).toEqual({ control: false, shifted: false, plain: true });
  await review.frame
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await review.frame.locator('h1').dblclick();
  await expect(review.frame.getByRole('dialog')).toBeVisible();
  expect(
    await review.evaluate(() => document.getSelection()!.toString()),
  ).toBeTruthy();
});

test('stale feedback remains visible and blocks sending after explicit refresh', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.addComment('h1', 'Preserve this note.');
  fs.appendFileSync(workspace.file(), '<p>Changed source.</p>');
  await expect(page.locator('#update')).toBeVisible();
  await page.locator('#refresh').click();
  await review.ready();
  await expect(page.locator('.draft-status')).toContainText('Stale revision');
  await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('.draft')).toContainText('Preserve this note.');
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
});

test('a message-only batch is valid and empty reviews cannot send', async ({
  page,
  plan,
  workspace,
}) => {
  await page.locator('#toggle-review').click();
  await expect(page.locator('#send')).toBeDisabled();
  await page.locator('#message').fill('An overall instruction.');
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(plan.session).events.length)
    .toBe(1);
  expect(workspace.store.get(plan.session).events[0].payload).toEqual({
    message: 'An overall instruction.',
    items: [],
  });
});

test('frame credentials stay isolated and foreign bridge messages cannot stage feedback', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  const denied = await review.evaluate(async (origin) => {
    try {
      return (await fetch(`${origin}/api/sessions`, { method: 'GET' })).status;
    } catch {
      return 'blocked';
    }
  }, workspace.origin);
  expect([403, 'blocked']).toContain(denied);
  await page.evaluate(() =>
    window.postMessage(
      {
        humagent: 1,
        method: 'stage',
        id: 'foreign',
        params: { item: { intent: 'evil', values: {} } },
      },
      location.origin,
    ),
  );
  expect((await review.state()).drafts).toHaveLength(0);
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
  expect(
    await review.evaluate(() => JSON.stringify(window.__HUMAGENT__)),
  ).not.toContain(new URL(plan.url).hash.slice(1));
});

test('one tab owns review editing and another can take ownership after it closes', async ({
  page,
  context,
  plan,
}) => {
  const other = await context.newPage();
  await other.goto(plan.url);
  await expect(other.locator('#readonly')).toBeVisible();
  await expect(other.locator('#annotate')).toBeDisabled();
  await page.close();
  await other.reload();
  await expect(other.locator('#bridge-status')).toHaveText(
    'Interface connected',
  );
  await expect(other.locator('#readonly')).toBeHidden();
  await expect(other.locator('#annotate')).toBeEnabled();
  await other.close();
});

test('the review tray fits desktop and narrow screens', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'Review the spacing and heading.');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await expect(page.locator('#tray')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const frame = await page.locator('#frame').boundingBox();
    expect(frame!.width).toBeGreaterThan(250);
    expect(frame!.height).toBeGreaterThan(170);
    await page.screenshot({ path: `.local/review-${width}.png` });
  }
});
