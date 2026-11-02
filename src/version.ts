import {readFileSync} from 'node:fs';

/** Read package metadata from the same relative location in src and dist. */
export const version: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;
export const runtimeName = process.versions.bun ? 'bun' : 'node';
export const runtimeVersion = process.versions.bun ?? process.versions.node;
