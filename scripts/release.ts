import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.versions.bun) throw new Error('Run release checks with Bun.');
const publish = process.argv.includes('--publish');
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

if (
  publish &&
  pkg.version === '0.1.0' &&
  !existsSync(path.join(root, 'CHANGELOG.md'))
) {
  console.log('Publish 0.1.0 manually, then configure npm trusted publishing.');
} else {
  run(['run', 'check']);
  run(['run', 'test:browser:built']);
  rmSync(path.join(root, output), { recursive: true, force: true });
  run(['run', 'changeset', 'pack', '--out-dir', output]);
  if (existsSync(archive)) {
    const env = { ...process.env, HUMAGENT_TEST_ARCHIVE: archive };
    execFileSync('node', ['test/install.ts'], {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    run(['run', 'test:runners'], env);
  }
  if (publish) {
    run([
      'run',
      'changeset',
      'publish',
      ...(existsSync(archive) ? ['--from-pack-dir', output] : []),
    ]);
  } else if (!existsSync(archive)) {
    console.log('No unpublished package to verify.');
  }
}
