import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.versions.bun) throw new Error('Run release checks with Bun.');
const publish = process.argv[2] === '--publish';
if (process.argv.length > (publish ? 3 : 2))
  throw new Error('Usage: bun scripts/release.ts [--publish]');

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = '.local/release';
const archive = path.join(
  root,
  output,
  'packages',
  `humagent-${pkg.version}.tgz`,
);
const run = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  execFileSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });

rmSync(path.join(root, output), { recursive: true, force: true });
run(['run', 'changeset', 'pack', '--out-dir', output]);

if (!existsSync(archive)) {
  if (publish) {
    const name = encodeURIComponent(pkg.name);
    const response = await fetch(
      `https://registry.npmjs.org/${name}/${pkg.version}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const version = response.ok ? (await response.json()).version : null;
    if (version !== pkg.version)
      throw new Error(
        'Changesets produced no archive for an unpublished version. Refusing to publish.',
      );
  }
  console.log('No unpublished package to release.');
} else {
  if (publish && !existsSync(path.join(root, 'CHANGELOG.md')))
    throw new Error(
      'Publish the initial version manually before enabling automated releases.',
    );

  run(['run', 'check']);
  run(['run', 'test:browser:built']);
  const env = { ...process.env, HUMAGENT_TEST_ARCHIVE: archive };
  execFileSync('node', ['test/install.ts'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  run(['run', 'test:runners'], env);
  if (publish)
    run(['run', 'changeset', 'publish', '--from-pack-dir', output]);
}
