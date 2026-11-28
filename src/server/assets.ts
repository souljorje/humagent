/** The built browser code of the workspace and the page SDK. */
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensure } from '@/shared/validate';
import { standalone } from './version';

/** Headers that stop caching and MIME sniffing of a response. */
export const noStore = (type: string, extra: Record<string, string> = {}) => ({
  'content-type': type,
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  ...extra,
});

/** Browser code has this path prefix on the control origin and on each page origin. */
export const ASSET_PREFIX = '/__humagent/';
export const CLIENT = fileURLToPath(
  new URL(standalone ? './client/' : '../client/', import.meta.url),
);
export const EXAMPLES = fileURLToPath(
  new URL(standalone ? './examples/' : '../examples/', import.meta.url),
);
export const WORKSPACE = path.join(CLIENT, 'ui/index.html');
export const MANIFEST = path.join(CLIENT, '.vite/manifest.json');

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
};
// A name has no dot, so a path cannot leave the directory.
const ASSET = /^assets\/[\w-]+(\.(?:js|css))$/;

/** Read built browser code by its path below the prefix. */
export async function asset(pathname: string) {
  const name = pathname.slice(ASSET_PREFIX.length);
  const type = TYPES[ASSET.exec(name)?.[1] ?? ''];
  const body =
    type && (await fs.readFile(path.join(CLIENT, name)).catch(() => null));
  ensure(type && body, 'Not found', 'NOT_FOUND', 404);
  return { body, headers: noStore(type) };
}

/** The part of Vite's build manifest that the server reads. */
type Manifest = Record<
  string,
  { file: string; css?: string[]; imports?: string[] }
>;
const SDK = 'sdk/sdk.ts';

/** The style sheets of a module and its imports. */
function sheetsOf(manifest: Manifest, name: string): string[] {
  const { css = [], imports = [] } = manifest[name]!;
  return [...imports.flatMap((item) => sheetsOf(manifest, item)), ...css];
}
const assetUrl = (file: string) => ASSET_PREFIX + file;

/** The built page SDK. */
export function builtSdk() {
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  return {
    script: assetUrl(manifest[SDK]!.file),
    styles: [...new Set(sheetsOf(manifest, SDK))].map(assetUrl),
  };
}
