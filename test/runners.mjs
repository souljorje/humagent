import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const archive = path.resolve(
  process.env.HUMAGENT_TEST_ARCHIVE ?? `${pkg.name}-${pkg.version}.tgz`,
);
assert.ok(fs.existsSync(archive), 'Run bun pm pack first');
const temporary = fixture('runners');
const cwd = path.join(temporary, 'project');
fs.mkdirSync(cwd);
const env = {
  ...process.env,
  HUMAGENT_HOME: path.join(temporary, 'state'),
  HUMAGENT_PORT: '0',
  npm_config_cache: path.join(temporary, 'cache'),
  npm_config_update_notifier: 'false',
  XDG_CACHE_HOME: path.join(temporary, 'cache'),
  XDG_DATA_HOME: path.join(temporary, 'data'),
};
const run = async (command, args, workingDirectory = cwd, extraEnv = {}) =>
  (
    await exec(command, args, {
      cwd: workingDirectory,
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
      timeout: 60000,
    })
  ).stdout;
try {
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    '{"name":"runner-fixture","private":true}',
  );
  await run('npm', ['install', '--no-audit', '--no-fund', archive]);
  assert.equal(
    JSON.parse(
      await run('bunx', [
        '--bun',
        '--no-install',
        'humagent',
        'doctor',
        '--json',
      ]),
    ).runtime,
    'bun',
  );
  const opened = JSON.parse(
    await run('bunx', [
      '--bun',
      '--no-install',
      'humagent',
      'demo',
      '--no-open',
      '--json',
    ]),
  );
  assert.ok(opened.session);
  assert.equal(
    JSON.parse(
      fs
        .readFileSync(path.join(env.HUMAGENT_HOME, 'server.log'), 'utf8')
        .trim(),
    ).runtime,
    'bun',
  );
  await run('bunx', ['--bun', '--no-install', 'humagent', 'stop', '--json']);
  const isolated = path.join(temporary, 'isolated');
  fs.mkdirSync(isolated);
  fs.writeFileSync(
    path.join(isolated, 'package.json'),
    '{"name":"isolated-runner-fixture","private":true}',
  );
  const store = path.join(temporary, 'pnpm-store');
  assert.equal(
    (
      await run(
        'pnpm',
        ['--package', archive, 'dlx', 'humagent', '--version'],
        isolated,
        { pnpm_config_store_dir: store, npm_config_store_dir: store },
      )
    ).trim(),
    pkg.version,
  );
  // No local dependency or cached package can satisfy this npx invocation.
  const fresh = {
    ...env,
    npm_config_cache: path.join(temporary, 'fresh-cache'),
  };
  const installed = await exec(
    'npx',
    ['--yes', `--package=${archive}`, 'humagent', '--version'],
    { cwd: isolated, env: fresh, encoding: 'utf8', timeout: 60000 },
  );
  assert.equal(installed.stdout.trim(), pkg.version);
  assert.ok(
    fs
      .readdirSync(path.join(fresh.npm_config_cache, '_npx'), {
        recursive: true,
      })
      .some((file) =>
        file
          .split(path.sep)
          .join('/')
          .endsWith('node_modules/humagent/package.json'),
      ),
    'npx must install the archive into its fresh cache',
  );
  console.log(
    'PASS bunx --bun, pnpm dlx, and fresh-cache npx execute the release archive',
  );
} finally {
  try {
    await run('bunx', ['--bun', '--no-install', 'humagent', 'stop', '--json']);
  } catch {}
  for (
    let i = 0;
    i < 100 && fs.existsSync(path.join(env.HUMAGENT_HOME, 'server.lock'));
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
  fs.rmSync(temporary, { recursive: true, force: true });
}
