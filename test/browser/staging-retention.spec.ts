import { test, expect } from './fixtures.ts';

test('unresolved staging identities survive rejected handshakes and reloads', async ({
  page,
  review,
}) => {
  await page.addInitScript(() => {
    addEventListener(
      'message',
      (event) => {
        if (event.data?.method === 'stageReceived')
          event.stopImmediatePropagation();
      },
      true,
    );
  });
  await review.open();
  await review.addComment('h1', 'Keep the saved feedback');
  const before = await review.state();
  expect(Object.keys(before.staged)).toHaveLength(1);
  const reject = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/surface') &&
      response.status() >= 400,
  );
  await review.evaluate(() => {
    const boot = window.__HUMAGENT__!;
    parent.postMessage(
      {
        ...boot,
        humagent: 1,
        method: 'hello',
        params: {},
        documentId: 'not-a-served-document',
      },
      boot.parentOrigin,
    );
  });
  await reject;
  expect((await review.state()).staged).toEqual(before.staged);
  const activate = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/surface') && response.ok(),
  );
  await review.evaluate(() => {
    const boot = window.__HUMAGENT__!;
    parent.postMessage(
      { ...boot, humagent: 1, method: 'hello', params: {} },
      boot.parentOrigin,
    );
  });
  await activate;
  expect((await review.state()).staged).toEqual(before.staged);
  await page.reload();
  await review.ready();
  expect((await review.state()).staged).toEqual(before.staged);
  expect((await review.state()).drafts).toEqual(before.drafts);
});
