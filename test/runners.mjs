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
};
const run = async (command, args) =>
  (
    await exec(command, args, {
      cwd,
      env,
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
  await run('bun', [
    '--input-type=module',
    '--eval',
    "import assert from 'node:assert/strict'; import {createRuntime} from 'humagent'; import {PROTOCOL} from 'humagent/protocol'; assert.equal(typeof createRuntime, 'function'); assert.equal(PROTOCOL, 2);",
  ]);
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
    'PASS bunx --bun and fresh-cache npx execute the release archive',
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
