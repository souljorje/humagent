import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import metadata from '../package.json';
import { bunRevision } from '../toolchain.json';

export function assertToolchain() {
  if (Bun.revision !== bunRevision)
    throw new Error(
      `Expected Bun revision ${bunRevision}, found ${Bun.revision}. Install it with npm install --global ${metadata.packageManager}.`,
    );
}

if (import.meta.main) {
  assertToolchain();
  const directory = new URL('../.turbo/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    new URL('runtime.json', directory),
    `${JSON.stringify({
      bun: Bun.revision,
      node: execFileSync('node', ['--version'], { encoding: 'utf8' }).trim(),
      platform: process.platform,
      arch: process.arch,
    })}\n`,
  );
}
