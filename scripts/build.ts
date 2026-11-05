import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!process.versions.bun) throw new Error('Build with Bun: bun run build');
const root = fileURLToPath(new URL('../', import.meta.url));
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
execFileSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
  { cwd: root, stdio: 'inherit' },
);
for (const directory of ['ui', 'examples']) {
  cpSync(
    new URL(`../src/${directory}/`, import.meta.url),
    new URL(`../dist/${directory}/`, import.meta.url),
    { recursive: true, filter: (source) => !source.endsWith('.ts') },
  );
}
chmodSync(new URL('../dist/cli/index.js', import.meta.url), 0o755);
