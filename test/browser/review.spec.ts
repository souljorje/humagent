import fs from 'node:fs';
import { test, expect } from './fixtures.ts';

test('shadow-root targets survive refresh and invalidate when their identity changes', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.addInitScript(() => {
    if (window.parent === window) return;
    document.addEventListener('DOMContentLoaded', () => {
      const host = document.createElement('section');
      host.id = 'shadow-target';
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<button id="shadow-action">Shadow action</button>';
      document.body.prepend(host);
    });
  });
  await page.reload();
  await review.ready();
  await review.addComment('#shadow-action', 'Keep this target');
  await page.locator('#toggle-review').click();
  await Promise.all([
    page.waitForEvent(
      'framenavigated',
      (frame) => frame.parentFrame() === page.mainFrame(),
    ),
    review.evaluate(() => location.reload()),
  ]);
  await review.ready();
  await expect(review.frame.locator('.marker:visible')).toHaveCount(1);
  await review.frame.locator('.marker').click();
  await expect(review.frame.getByLabel('Comment', { exact: true })).toHaveValue(
    'Keep this target',
  );
  await review.evaluate(() => {
    document
      .querySelector('#shadow-target')!
      .shadowRoot!.querySelector('button')!.id = 'different-action';
  });
  await expect(review.frame.locator('.marker:visible')).toHaveCount(0);
  await expect(review.frame.locator('#highlight')).toBeHidden();
  expect((await review.state()).drafts[0].item.target!.id).toBe(
    'shadow-action',
  );
});

test('lost edit and delete acknowledgments do not repeat mutations', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.addInitScript(() => {
    let dropped = false;
    window.addEventListener(
      'message',
      (event) => {
        if (
          !dropped &&
          event.data?.method === 'result' &&
          event.data.result?.ok === true
        ) {
          dropped = true;
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  });
  await page.reload();
  await review.ready();
  await review.addComment('h1', 'Original');
  const id = (await review.state()).drafts[0].item.id;
  await review.frame.locator('.marker').click();
  await review.frame.getByLabel('Comment', { exact: true }).fill('Updated');
  await review.frame.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(review.frame.getByRole('dialog')).toBeHidden({ timeout: 15000 });
  expect((await review.state()).drafts).toHaveLength(1);
  expect((await review.state()).drafts[0].item).toMatchObject({
    id,
    comment: 'Updated',
  });
  await page.reload();
  await review.ready();
  await review.frame.locator('.marker').click();
  await review.frame.getByRole('button', { name: 'Delete comment' }).click();
  await expect(page.locator('#annotate')).toBeEnabled();
  await expect.poll(async () => (await review.state()).drafts.length).toBe(0);
  await expect(page.locator('#error')).toBeHidden();
});

test('pending markers are read only and disappear after matching server confirmation', async ({
  page,
  plan,
  review,
}) => {
  const pattern = `**/api/sessions/${plan.session}/events`;
  await review.addComment('h1', 'Pending comment');
  await page.route(pattern, async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.locator('#send').click();
  await expect(page.locator('#error')).toBeVisible();
  await review.frame.locator('.marker').click();
  await expect(
    review.frame.getByLabel('Comment', { exact: true }),
  ).toHaveAttribute('readonly', '');
  await expect(
    review.frame.getByRole('button', { name: 'Delete comment' }),
  ).toBeDisabled();
  await expect(
    review.frame.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await page.unroute(pattern);
  await page.getByRole('button', { name: 'Retry send' }).click();
  await expect(review.frame.locator('.marker')).toHaveCount(0);
});

test('old document messages cannot edit or remove current feedback', async ({
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'Keep this');
  const id = (await review.state()).drafts[0].item.id;
  await review.evaluate((draftId) => {
    const boot = window.__HUMAGENT__!;
    for (const method of ['edit', 'remove'])
      parent.postMessage(
        {
          ...boot,
          humagent: 1,
          documentId: 'previous-document',
          method,
          id: crypto.randomUUID(),
          params: { draftId, comment: 'Wrong document' },
        },
        boot.parentOrigin,
      );
  }, id);
  await expect(review.frame.locator('.marker')).toHaveCount(1);
  expect((await review.state()).drafts[0].item.comment).toBe('Keep this');
});

test('editors fit viewport edges and reduced motion disables transitions', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await review.addComment('h1', 'Keep the target visible');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await review.frame.locator('.marker').click();
    await expect
      .poll(async () => {
        const panel = await review.frame.locator('#panel').boundingBox();
        return (
          !!panel &&
          panel.x >= 0 &&
          panel.y >= 0 &&
          panel.x + panel.width <= width &&
          panel.y + panel.height <= 844
        );
      })
      .toBe(true);
    expect(
      await review.frame
        .locator('#panel')
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe('0s');
    const target = await review.frame.locator('h1').boundingBox();
    const panel = await review.frame.locator('#panel').boundingBox();
    if (width < 500)
      expect(panel!.y).toBeGreaterThanOrEqual(target!.y + target!.height);
    await review.frame
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
  }
});

test('commenting stays enabled, hover highlights, and confirmation creates a clickable marker', async ({
  page,
  plan: _plan,
  review,
}) => {
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.locator('#annotate').click();
  await review.frame.locator('h1').hover();
  await expect(review.frame.locator('#highlight')).toBeVisible();
  await review.frame.locator('h1').click();
  await expect(
    review.frame.getByRole('button', { name: 'Add comment' }),
  ).toBeDisabled();
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Shorter heading');
  await review.frame.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#toggle-review')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(review.frame.locator('.marker')).toHaveText('1');
  await page.locator('#annotate').click();
  await review.frame.locator('input[name="outcome"]').fill('Native input');
  await review.frame.locator('.marker').click();
  await expect(review.frame.getByLabel('Comment', { exact: true })).toHaveValue(
    'Shorter heading',
  );
  await expect(
    review.frame.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
});

test('unfinished feedback survives reselection and blocks refresh and send', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.locator('#message').fill('Overall instruction');
  await page.locator('#annotate').click();
  await review.frame.locator('h1').click();
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Keep this unfinished note');
  await review.evaluate(() =>
    document
      .querySelector('[data-humagent-id="brief"]')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      ),
  );
  await expect(review.frame.getByLabel('Comment', { exact: true })).toHaveValue(
    'Keep this unfinished note',
  );
  await expect(page.locator('#send')).toBeDisabled();
  const documentId = await review.evaluate(
    () => window.__HUMAGENT__!.documentId,
  );
  expect(
    await review.evaluate(
      () =>
        !window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ),
  ).toBe(true);
  expect(await review.evaluate(() => window.__HUMAGENT__!.documentId)).toBe(
    documentId,
  );
  await review.frame.getByRole('button', { name: 'Add comment' }).click();
  await expect
    .poll(async () => (await review.state()).drafts[0]?.item.target?.id)
    .toBe('headline');
});

test('native selection and context menus are untouched when commenting is off', async ({
  plan: _plan,
  review,
}) => {
  const results = await review.evaluate(() => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<input value="Native control">';
    return [document.querySelector('h1')!, root.querySelector('input')!].map(
      (el) => {
        const event = new MouseEvent('contextmenu', {
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      },
    );
  });
  expect(results).toEqual([false, false]);
  await review.frame.locator('h1').dblclick();
  expect(
    await review.evaluate(() => document.getSelection()!.toString()),
  ).toBeTruthy();
  await expect(review.frame.getByRole('dialog')).toBeHidden();
});

test('keyboard targeting and Escape restore normal interaction', async ({
  page,
  plan: _plan,
  review,
}) => {
  await page.locator('#annotate').focus();
  await page.keyboard.press('Enter');
  await expect(review.frame.locator('#keyboard-hint')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(review.frame.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(review.frame.getByRole('dialog')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#annotate')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('#annotate')).toBeFocused();
});

test('commenting captures controls without activating them', async ({
  page,
  review,
  app,
}) => {
  await review.open(app.origin + '/nested');
  await page.locator('#annotate').click();
  await review.frame.locator('#counter').click();
  await expect(review.frame.locator('#counter')).toHaveText('Count: 0');
  await review.frame.getByLabel('Comment', { exact: true }).fill('This button');
  await review.frame.getByRole('button', { name: 'Add comment' }).click();
  await page.locator('#annotate').click();
  await review.frame.locator('#counter').click();
  await expect(review.frame.locator('#counter')).toHaveText('Count: 1');
});

test('inline edits preserve IDs, cancel preserves saved content, and deletion renumbers markers', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'First');
  await review.addComment('[data-humagent-id="brief"]', 'Second');
  const ids = (await review.state()).drafts.map((d) => d.item.id);
  await review.frame.locator(`.marker[data-draft-id="${ids[1]}"]`).click();
  await expect(
    review.frame.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Discard this');
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  expect((await review.state()).drafts[1].item.comment).toBe('Second');
  await review.frame.locator(`.marker[data-draft-id="${ids[1]}"]`).click();
  await review.frame
    .getByLabel('Comment', { exact: true })
    .fill('Changed second');
  await review.frame.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await review.state()).drafts[1].item.comment)
    .toBe('Changed second');
  await review.frame.locator(`.marker[data-draft-id="${ids[0]}"]`).click();
  await review.frame.getByRole('button', { name: 'Delete comment' }).click();
  await expect(review.frame.locator('.marker')).toHaveCount(1);
  await expect(review.frame.locator('.marker')).toHaveText('1');
  await page.reload();
  await review.ready();
  expect((await review.state()).drafts[0].item.id).toBe(ids[1]);
});

for (const trigger of ['button', 'Control+Enter', 'Meta+Enter'])
  test(`sending waits for unfinished draft edits via ${trigger}`, async ({
    page,
    plan,
    review,
    workspace,
  }) => {
    await review.addComment('h1', 'Original comment');
    await review.frame.locator('.marker').click();
    await review.frame
      .getByLabel('Comment', { exact: true })
      .fill('Updated comment');
    await expect(page.locator('#send')).toBeDisabled();
    if (trigger === 'button')
      await page.locator('#send').dispatchEvent('click');
    else await page.locator('#message').press(trigger);
    expect(workspace.store.get(plan.session).events).toHaveLength(0);
    await expect(
      review.frame.getByLabel('Comment', { exact: true }),
    ).toHaveValue('Updated comment');
    expect((await review.state()).drafts[0].item.comment).toBe(
      'Original comment',
    );
    const cancelled = trigger === 'button';
    await review.frame
      .getByRole('button', { name: cancelled ? 'Cancel' : 'Save', exact: true })
      .click();
    await page.locator('#send').click();
    await expect
      .poll(() => workspace.store.get(plan.session).events.length)
      .toBe(1);
    expect(
      workspace.store.get(plan.session).events[0].payload.items[0].comment,
    ).toBe(cancelled ? 'Original comment' : 'Updated comment');
  });

test('comments and exact deletion send in creation order without changing source', async ({
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
  await expect(review.frame.locator('.marker')).toHaveCount(3);
  await page.locator('#message').fill('Apply these together.');
  await page.locator('#send').click();
  await expect
    .poll(() => workspace.store.get(plan.session).events.length)
    .toBe(1);
  await expect(review.frame.locator('.marker:visible')).toHaveCount(0);
  await expect(page.locator('#activity')).toHaveText('Sent');
  const event = workspace.store.get(plan.session).events[0];
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

test('marker nodes and keyboard focus survive polling and scrolling', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'First');
  const marker = review.frame.locator('.marker');
  await marker.focus();
  const same = await review.evaluate(async () => {
    const root = document.querySelector('[data-humagent-ui]')!.shadowRoot!;
    const marker = root.querySelector('.marker');
    dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('scroll'));
    await new Promise(requestAnimationFrame);
    return marker === root.querySelector('.marker');
  });
  expect(same).toBe(true);
  await page.waitForTimeout(3200);
  await expect(marker).toBeFocused();
});

for (const attribute of ['data-humagent-id', 'id'])
  test(`reused targets become unavailable when ${attribute} changes`, async ({
    page,
    plan: _plan,
    review,
  }) => {
    await review.evaluate((attribute) => {
      const heading = document.querySelector('h1')!;
      heading.removeAttribute('data-humagent-id');
      heading.removeAttribute('id');
      heading.setAttribute(attribute, 'original-target');
    }, attribute);
    await review.addComment('h1', 'Keep my original target');
    await expect(review.frame.locator('.marker')).toHaveCount(1);
    const target = (await review.state()).drafts[0].item.target;
    await review.evaluate((attribute) => {
      document.querySelector('h1')!.setAttribute(attribute, 'different-target');
    }, attribute);
    await expect(page.locator('.draft-status')).toContainText(
      'Target unavailable',
    );
    await expect(review.frame.locator('.marker:visible')).toHaveCount(0);
    expect((await review.state()).drafts[0].item.target).toEqual(target);
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
  await expect(review.frame.locator('.marker:visible')).toHaveCount(0);
});

test('stale feedback remains visible and blocks sending after explicit refresh', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.addComment('h1', 'Preserve this note.');
  fs.appendFileSync(workspace.file(), '<p>Changed source.</p>');
  await page.locator('#toggle-review').click();
  await expect(page.locator('#update')).toBeVisible();
  await review.evaluate(() => location.reload());
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
  await other.locator('#take-over').click();
  await expect(other.locator('#bridge-status')).toHaveText(
    'Interface connected',
  );
  await expect(other.locator('#readonly')).toBeHidden();
  await expect(other.locator('#annotate')).toBeEnabled();
  await other.close();
});

test('the floating bar expands within desktop and narrow screens', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'Review the spacing and heading.');
  await page.locator('#toggle-review').click();
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
