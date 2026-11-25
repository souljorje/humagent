import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ensure } from '../shared/validate.js';

/** Headers that stop caching and MIME sniffing of a response. */
export const noStore = (type: string, extra: Record<string, string> = {}) => ({
  'content-type': type,
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  ...extra,
});

/** Match files at any depth below these directories. A name has no dot, so a path cannot leave its directory. */
const assetIn = (directories: readonly string[], extensions: string) =>
  new RegExp(
    `^/(?:${directories.join('|')})(?:/[a-z][a-z0-9-]*)+\\.(?:${extensions})$`,
  );
/** Public directories of the workspace. */
export const UI_DIRECTORIES = ['ui', 'shared', 'plugins'] as const;
export const UI_ASSET = assetIn(UI_DIRECTORIES, 'js|css');
/** Browser modules that the page SDK loads. */
export const SDK_ASSET = assetIn(['sdk', 'shared', 'plugins'], 'js');

/** Read a shipped browser module, such as `/ui/app.js`. `allowed` keeps runtime code and package metadata private. */
export async function browserAsset(pathname: string, allowed: RegExp) {
  const body =
    allowed.test(pathname) &&
    (await fs
      .readFile(fileURLToPath(new URL(`..${pathname}`, import.meta.url)))
      .catch(() => null));
  ensure(body, 'Not found', 'NOT_FOUND', 404);
  const type = pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
  return { body, headers: noStore(type) };
}
