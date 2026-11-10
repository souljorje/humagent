import fs from 'node:fs';
import { test, expect } from './fixtures.ts';

test('old document messages cannot edit or remove current feedback', async ({
  plan: _plan,
  review,
}) => {
  await review.addComment('h1', 'Keep this');
  const id = (await review.draft()).id;
  await review.evaluate((draftId) => {
    const boot = window.__HUMAGENT__!;
    for (const method of ['edit', 'remove'])
      parent.postMessage(
        {
          ...boot,
          documentId: 'previous-document',
          method,
          id: crypto.randomUUID(),
          params: { draftId, comment: 'Wrong document' },
        },
        boot.parentOrigin,
      );
  }, id);
  await expect(review.frame.locator('.marker')).toHaveCount(1);
  expect((await review.draft()).comment).toBe('Keep this');
});

test('commenting stays enabled, hover highlights, and confirmation creates a clickable marker', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  await review.annotate();
  await review.frame.locator('h1').hover();
  await expect(review.frame.locator('#highlight')).toBeVisible();
  await review.frame.locator('h1').click();
  await expect(
    review.frame.getByRole('button', { name: 'Confirm text edit' }),
  ).toBeDisabled();
  await review.note.fill('Shorter heading');
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
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
  await expect(review.note).toHaveValue('Shorter heading');
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
  await review.annotate();
  await review.frame.locator('h1').click();
  await review.note.fill('Keep this unfinished note');
  await review.evaluate(() =>
    document
      .querySelector('[data-humagent-id="brief"]')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      ),
  );
  await expect(review.note).toHaveValue('Keep this unfinished note');
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
  await review.frame.getByRole('button', { name: 'Confirm text edit' }).click();
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

for (const trigger of ['button', 'Control+Enter'])
  test(`sending waits for unfinished draft edits via ${trigger}`, async ({
    page,
    plan,
    review,
    workspace,
  }) => {
    await review.addComment('h1', 'Original comment');
    await review.frame.locator('.marker').click();
    await review.note.fill('Updated comment');
    await expect(page.locator('#send')).toBeDisabled();
    if (trigger === 'button')
      await page.locator('#send').dispatchEvent('click');
    else await page.locator('#message').press(trigger);
    expect(workspace.store.get(plan.session).events).toHaveLength(0);
    await expect(review.note).toHaveValue('Updated comment');
    expect((await review.draft()).comment).toBe('Original comment');
    const cancelled = trigger === 'button';
    await review.frame
      .getByRole('button', { name: cancelled ? 'Cancel' : 'Save', exact: true })
      .click();
    await review.connect();
    await page.locator('#send').click();
    expect((await review.events(1))[0].items[0].comment).toBe(
      cancelled ? 'Original comment' : 'Updated comment',
    );
  });

test('comments and exact deletion send in creation order without changing source', async ({
  page,
  plan: _plan,
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
  await review.connect();
  await page.locator('#send').click();
  const [event] = await review.events(1);
  await expect(review.frame.locator('.marker:visible')).toHaveCount(0);
  await expect(page.locator('#send')).toHaveText('Sent');
  expect(
    event.items.map((item) => item.comment || item.replacement!.after),
  ).toEqual(['A shorter heading.', 'Keep these boundaries.', '']);
  expect(event.items[2].replacement!.before).toBe(original);
  expect(event.items[2].target!.anchor).toMatchObject({
    quote: original,
  });
  expect(event.items[0].target).toMatchObject({
    id: 'headline',
    revision: event.revision,
  });
  expect(await review.frame.locator('h1').textContent()).toBe('');
  await review.deliver();
  await expect(review.frame.locator('h1')).toHaveText(original!);
  expect(fs.readFileSync(workspace.file(), 'utf8')).toBe(source);
});

test('reused targets become unavailable when data-humagent-id changes', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.evaluate(() => {
    const heading = document.querySelector('h1')!;
    heading.removeAttribute('id');
    heading.setAttribute('data-humagent-id', 'original-target');
  });
  await review.addComment('h1', 'Keep my original target');
  await expect(review.frame.locator('.marker')).toHaveCount(1);
  const target = (await review.draft()).target;
  await review.evaluate(() => {
    document
      .querySelector('h1')!
      .setAttribute('data-humagent-id', 'different-target');
  });
  await expect(page.locator('.draft-status')).toContainText(
    'Target unavailable',
  );
  await expect(review.frame.locator('.marker:visible')).toHaveCount(0);
  expect((await review.draft()).target).toEqual(target);
});

test('comments follow selectors through text changes and rerenders in a mini-app', async ({
  page,
  plan: _plan,
  review,
}) => {
  await review.expand(false);
  await review.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'comment-host';
    host.style.cssText = 'position:fixed;left:40px;top:40px;width:400px';
    host.innerHTML =
      '<section style="height:180px;padding:20px"><p>Live section</p><button>Count: 0</button></section>';
    document.body.prepend(host);
  });
  await review.annotate();
  const target = review.frame.locator('#comment-host section');
  await target.click({ position: { x: 350, y: 160 } });
  const status = page.locator('.draft-status');
  await review.note.fill('Keep this comment attached');
  await review.note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  const original = (await review.state()).drafts[0];
  await target
    .locator('button')
    .evaluate((el) => (el.textContent = 'Count: 3'));
  await review.frame.locator('.marker').click();
  await expect(review.note).toHaveValue('Keep this comment attached');
  await review.note.fill('Updated comment');
  await target.evaluate((el) => el.replaceWith(el.cloneNode(true)));
  await review.note.press('Enter');
  await expect(review.frame.locator('#panel')).toBeHidden();
  await expect(status).toHaveCount(0);
  const updated = (await review.state()).drafts[0];
  expect(updated.item.id).toBe(original.item.id);
  expect(updated.item.target).toEqual(original.item.target);
  expect(updated.item.comment).toBe('Updated comment');
  await target.evaluate((el) => el.remove());
  await expect(status).toContainText('Target unavailable');
  await review.evaluate(() => {
    document.querySelector('#comment-host')!.innerHTML =
      '<section style="height:180px;padding:20px">Replacement content</section>';
  });
  await expect(status).toHaveCount(0);
  await review.frame.locator('.marker').click();
  await expect(review.note).toHaveValue('Updated comment');
  await target.evaluate((el) => el.after(el.cloneNode(true)));
  await expect(status).toContainText('Target unavailable');
});

test('stale feedback remains visible and blocks sending after explicit refresh', async ({
  page,
  plan,
  review,
  workspace,
}) => {
  await review.addComment('h1', 'Preserve this note.');
  fs.appendFileSync(workspace.file(), '<p>Changed source.</p>');
  await review.expand();
  await expect(page.locator('#update')).toBeVisible();
  await review.evaluate(() => location.reload());
  await review.ready();
  await expect(page.locator('.draft-status')).toContainText('Stale revision');
  await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('.draft')).toContainText('Preserve this note.');
  expect(workspace.store.get(plan.session).events).toHaveLength(0);
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
  const sandbox = await page.locator('#frame').getAttribute('sandbox');
  for (const token of ['allow-scripts', 'allow-forms', 'allow-same-origin'])
    expect(sandbox).toContain(token);
  for (const token of ['allow-top-navigation', 'allow-popups'])
    expect(sandbox).not.toContain(token);
  await expect(review.frame.locator('h1')).toBeVisible();
});

test('two tabs edit one session and see each other’s feedback', async ({
  context,
  plan,
  review,
}) => {
  const other = await context.newPage();
  await other.goto(plan.url);
  await expect(other.locator('#bridge-status')).toHaveText(
    'Interface connected',
  );
  await expect(other.locator('#annotate')).toBeEnabled();
  await review.addComment('h1', 'From the first tab');
  await expect(other.locator('.draft')).toContainText('From the first tab');
  await other.close();
});
