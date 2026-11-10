import { test, expect } from './fixtures.ts';

test('commenting makes text selectable even where the page blocks selection', async ({
  page,
  plan: _plan,
  review,
}) => {
  const annotate = page.locator('#annotate');
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'true');
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'false');
  await review.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button style="user-select:none"><span id="mode-words">Select this text</span></button>',
    );
  });
  await annotate.click();
  await expect(annotate).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      review.frame
        .locator('#mode-words')
        .evaluate((el) => getComputedStyle(el).userSelect),
    )
    .toBe('text');
});

test('frequent updates preserve annotations without global rescans in mini-apps', async ({
  page,
  plan: opened,
  review,
}) => {
  await review.evaluate(() => {
    const section = document.createElement('section');
    section.id = 'busy-app';
    for (let i = 0; i < 1000; i++)
      section.append(document.createElement('span'));
    const ticker = document.createElement('p');
    ticker.id = 'busy-ticker';
    section.append(ticker);
    document.body.append(section);
  });
  await review.addComment('h1', 'Keep this attached');
  expect((await review.state()).drafts).toHaveLength(1);
  const markers = review.frame.locator('.marker');
  const result = await review.evaluate(async () => {
    const query = document.querySelectorAll;
    const root = document.querySelector('div[data-humagent-ui]')!.shadowRoot!;
    const controls = root.querySelectorAll;
    let globalScans = 0,
      buttonScans = 0,
      markerWrites = 0;
    document.querySelectorAll = function (selector: string) {
      if (selector === '*') globalScans++;
      return query.call(document, selector);
    } as typeof query;
    root.querySelectorAll = function (selector: string) {
      if (selector.includes('button')) buttonScans++;
      return controls.call(root, selector);
    } as typeof controls;
    const observer = new MutationObserver((records) => {
      markerWrites += records.length;
    });
    observer.observe(root.querySelector('.marker')!, { childList: true });
    try {
      const ticker = document.getElementById('busy-ticker')!;
      for (let i = 0; i < 50; i++) {
        ticker.textContent = `Update ${i}`;
        ticker.className = `tick-${i % 2}`;
        ticker.style.opacity = i % 2 ? '.9' : '1';
        if (i === 10) {
          const host = document.createElement('div');
          host.style.cssText =
            'position:fixed;left:40px;top:300px;font:20px monospace';
          host.innerHTML = '<p id="busy-words">New plain text</p>';
          document.body.append(host);
        }
        await new Promise(requestAnimationFrame);
      }
      return { globalScans, buttonScans, markerWrites };
    } finally {
      document.querySelectorAll = query;
      root.querySelectorAll = controls;
      observer.disconnect();
    }
  });
  expect(result).toEqual({ globalScans: 0, buttonScans: 0, markerWrites: 0 });
  await expect(markers).toHaveCount(1);
  await markers.click();
  await expect(review.note).toHaveValue('Keep this attached');
  await review.frame
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await review.frame.locator('#busy-words').click();
  await expect(review.editor).toBeFocused();
  await review.editor.press('Escape');
  await review.evaluate(() => {
    document.body.dataset.presentations = '0';
    addEventListener('message', (event) => {
      if (event.source === parent && event.data?.method === 'update')
        document.body.dataset.presentations = String(
          Number(document.body.dataset.presentations) + 1,
        );
    });
  });
  await page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/sessions/${opened.session}`,
  );
  expect(await review.evaluate(() => document.body.dataset.presentations)).toBe(
    '0',
  );
});
