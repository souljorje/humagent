import metadata from '../../package.json';

/** The standalone build supplies a distinct version for daemon ownership. */
declare const __HUMAGENT_STANDALONE_VERSION__: string;

/** Bundle metadata so a standalone executable needs no adjacent package.json. */
export const version: string =
  typeof __HUMAGENT_STANDALONE_VERSION__ === 'string'
    ? __HUMAGENT_STANDALONE_VERSION__
    : metadata.version;
export const runtimeName = process.versions.bun ? 'bun' : 'node';
export const runtimeVersion = process.versions.bun ?? process.versions.node;
export const standalone =
  typeof Bun !== 'undefined' && Bun.isStandaloneExecutable;
