/** HTML documents: their size limit, their revision, and the SDK that each one loads. */
import { createHash } from 'node:crypto';
import { BOOTSTRAP_ID, type Bootstrap } from '@/shared/bridge';

/** The URLs of the page SDK. */
export interface Sdk {
  script: string;
  styles: readonly string[];
}
export const DOCUMENT_LIMIT = 8 * 1024 * 1024;
/** Attach the SDK to the HTML of a route. */
export type Decorate = (bytes: Buffer, route: string) => string;

export const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
/** The bootstrap is inert data, so an application policy without inline scripts still allows it. */
export function inject(html: string, bootstrap: Bootstrap, sdk: Sdk) {
  // Insert after the initial doctype, not a regex-matched </body> inside a script.
  const prefix = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  const links = sdk.styles
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join('');
  const encoded = JSON.stringify(bootstrap).replaceAll('<', '\\u003c');
  return `${prefix}<script type="application/json" id="${BOOTSTRAP_ID}">${encoded}</script>${links}<script type="module" src="${sdk.script}"></script>${html.slice(prefix.length)}`;
}
