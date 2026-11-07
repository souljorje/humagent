/** Test the archive as an npm user. No registry publication is performed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const archive = path.resolve(
  process.env.HUMAGENT_TEST_ARCHIVE ?? `${pkg.name}-${pkg.version}.tgz`,
);
const temporary = fixture('install');
const home = path.join(temporary, 'state');
// Remove the normal Bun directory. npm execution must not require Bun.
const env: NodeJS.ProcessEnv = {
  ...process.env,
  HUMAGENT_HOME: home,
  HUMAGENT_PORT: '0',
  npm_config_cache: path.join(temporary, 'cache'),
  npm_config_update_notifier: 'false',
};
const pathKey =
  Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
env[pathKey] = (env[pathKey] || '')
  .split(path.delimiter)
  .filter((item) => !/[\\/]\.bun[\\/]/i.test(item))
  .join(path.delimiter);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmRun = async (args: string[]) =>
  (
    await execute(npm, args, {
      cwd: temporary,
      env,
      encoding: 'utf8',
      timeout: 90000,
      shell: process.platform === 'win32',
    })
  ).stdout;
const run = async (...args: string[]) =>
  JSON.parse(
    await npmRun(['exec', '--offline', '--', 'humagent', ...args, '--json']),
  );
let app: http.Server | undefined;
try {
  assert.ok(fs.existsSync(archive), 'Run bun pm pack first');
  await execute('tar', ['-xzf', archive, '-C', temporary]);
  const root = path.join(temporary, 'package');
  const packaged = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  for (const file of ['node_modules', 'src', 'test', '.github', '.local'])
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  for (const hook of ['prepare', 'preinstall', 'install', 'postinstall'])
    assert.equal(packaged.scripts?.[hook], undefined, hook);
  assert.deepEqual(packaged.dependencies, pkg.dependencies);
  assert.equal(packaged.engines.node, '>=24');
  for (const file of [
    'dist/ui/index.html',
    'dist/ui/app.js',
    'dist/ui/app.css',
    'dist/sdk/sdk.js',
    'dist/shared/json.js',
    'dist/shared/batch.js',
    'dist/shared/review.d.ts',
    'dist/shared/bridge.d.ts',
    'dist/shared/errors.js',
    'dist/ui/review-state.js',
    'dist/sdk/forms.js',
    'dist/sdk/review.js',
    'dist/sdk/targets.js',
    'dist/examples/plan.html',
    'dist/examples/plan.css',
    'skills/humagent/SKILL.md',
    'docs/CLI.md',
    'docs/SDK.md',
    'docs/USAGE.md',
    'docs/SECURITY.md',
    'CONTRIBUTING.md',
    'AGENTS.md',
    'LICENSE',
    'README.md',
    ...Object.values(
      packaged.exports as Record<string, Record<string, string>>,
    ).flatMap(Object.values),
  ])
    assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.deepEqual(fs.readdirSync(path.join(root, 'dist/examples')).sort(), [
    'plan.css',
    'plan.html',
  ]);
  for (const file of fs.readdirSync(path.join(root, 'dist'), {
    recursive: true,
    encoding: 'utf8',
  }))
    assert.ok(
      !file.endsWith('.ts') || file.endsWith('.d.ts'),
      `Uncompiled source in package: ${file}`,
    );
  assert.ok(
    fs
      .readFileSync(path.join(root, packaged.bin.humagent), 'utf8')
      .startsWith('#!/usr/bin/env node\n'),
  );
  fs.writeFileSync(
    path.join(temporary, 'package.json'),
    '{"name":"install-fixture","private":true}',
  );
  await npmRun(['install', '--no-audit', '--no-fund', archive]);
  const installed = path.join(temporary, 'node_modules', 'humagent');
  const require = createRequire(path.join(installed, 'package.json'));
  for (const name of Object.keys(pkg.dependencies)) {
    const resolved = require.resolve(name);
    assert.ok(
      !path
        .relative(path.join(temporary, 'node_modules'), resolved)
        .startsWith('..'),
      `Runtime dependency resolved outside the installation: ${name}`,
    );
  }
  const importCheck = path.join(temporary, 'package-imports.ts');
  fs.copyFileSync(
    new URL('./helpers/package-imports.ts', import.meta.url),
    importCheck,
  );
  await execute(process.execPath, [importCheck], {
    cwd: temporary,
    env,
    timeout: 10000,
  });
  assert.equal((await run('--version')).version, pkg.version);
  const opened = await run('demo', '--no-open');
  const snapshot = await run('status', opened.session);
  assert.equal(fs.existsSync(snapshot.target.value), true);
  const record = JSON.parse(
    fs.readFileSync(path.join(home, 'server.json'), 'utf8'),
  );
  const startup = JSON.parse(
    fs.readFileSync(path.join(home, 'server.log'), 'utf8').trim(),
  );
  assert.equal(startup.runtime, 'node');
  const shell = await fetch(opened.url.split('#')[0]);
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /Humagent/);
  const surface = await fetch(snapshot.surface.frameUrl);
  assert.equal(surface.status, 200);
  assert.match(await surface.text(), /data-humagent-intent/);
  const waiting = run(
    'wait',
    opened.session,
    '--timeout',
    '10',
    '--lease',
    '60',
  );
  for (
    let attempt = 0;
    (await run('status', opened.session)).agent !== 'waiting';
    attempt++
  ) {
    assert.ok(attempt < 50, 'Agent must start waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const response = await fetch(
    `${record.origin}/api/sessions/${opened.session}/events`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-humagent-session': new URL(opened.url).hash.slice(1),
      },
      body: JSON.stringify({
        protocol: 2,
        clientId: 'installed-test',
        revision: snapshot.revision,
        payload: {
          items: [
            {
              id: 'decision',
              intent: 'revise_plan',
              values: { approach: 'pilot-first' },
            },
          ],
        },
      }),
    },
  );
  assert.equal(response.status, 200);
  const batch = await waiting;
  assert.equal(batch.events[0].payload.items[0].values.approach, 'pilot-first');
  await run('ack', opened.session, '--receipt', batch.receipt);
  assert.equal(
    (await run('status', opened.session)).events[0].status,
    'completed',
  );
  await run('setup');
  assert.equal((await run('setup')).unchanged, true);
  const generated = path.join(temporary, 'readme-example', 'review.html');
  fs.mkdirSync(path.dirname(generated));
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const html = readme.match(/```html\n([\s\S]*?)```/)?.[1];
  assert.ok(html, 'README must include the generated-page example');
  fs.writeFileSync(generated, html);
  const generatedExample = await run('open', generated, '--no-open');
  const generatedState = await run('status', generatedExample.session);
  assert.match(
    await (await fetch(generatedState.surface.frameUrl)).text(),
    /data-humagent-intent="revise_plan"/,
  );
  assert.equal(fs.readFileSync(generated, 'utf8'), html);
  app = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<h1>Installed package proxy</h1>');
  });
  await new Promise<void>((resolve) => app!.listen(0, '127.0.0.1', resolve));
  const attached = await run(
    'open',
    `http://127.0.0.1:${(app.address() as AddressInfo).port}`,
    '--no-open',
  );
  const appState = await run('status', attached.session);
  assert.match(
    await (await fetch(appState.surface.frameUrl)).text(),
    /Installed package proxy/,
  );
  await run('end', opened.session);
  assert.equal(
    (await run('wait', opened.session, '--timeout', '1')).status,
    'ended',
  );
  console.log(
    'PASS npm install from tarball and npm exec: demo, server, source, structured input, acknowledgment, skill, local proxy',
  );
  // npx delegates to npm exec. Exercise its actual binary as well.
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const npxResult = await execute(npx, ['--offline', 'humagent', '--version'], {
    cwd: temporary,
    env,
    encoding: 'utf8',
    timeout: 20000,
    shell: process.platform === 'win32',
  });
  assert.equal(npxResult.stdout.trim(), pkg.version);
  console.log('PASS npx executes the installed tarball with Node.js');
  const clean = path.join(temporary, 'npx-archive');
  fs.mkdirSync(clean);
  const fromArchive = await execute(
    npx,
    ['--offline', '--yes', '--package', archive, 'humagent', '--version'],
    {
      cwd: clean,
      env,
      encoding: 'utf8',
      timeout: 30000,
      shell: process.platform === 'win32',
    },
  );
  assert.equal(fromArchive.stdout.trim(), pkg.version);
  console.log(
    'PASS documented npx archive command works without a global installation',
  );
  const prefix = path.join(temporary, 'global');
  await npmRun([
    'install',
    '--offline',
    '--global',
    '--prefix',
    prefix,
    '--no-audit',
    '--no-fund',
    archive,
  ]);
  const executable = path.join(
    prefix,
    process.platform === 'win32' ? 'humagent.cmd' : 'bin/humagent',
  );
  const globalResult = await execute(executable, ['doctor', '--json'], {
    cwd: temporary,
    env,
    encoding: 'utf8',
    timeout: 20000,
    shell: process.platform === 'win32',
  });
  const doctor = JSON.parse(globalResult.stdout);
  assert.equal(doctor.version, pkg.version);
  assert.equal(doctor.runtime, 'node');
  assert.equal(doctor.filesPresent, true);
  console.log('PASS global npm installation provides the humagent command');
} finally {
  try {
    await run('stop');
  } catch {}
  for (let n = 0; n < 150 && fs.existsSync(path.join(home, 'server.lock')); n++)
    await new Promise((r) => setTimeout(r, 20));
  if (app) {
    app.closeAllConnections();
    await new Promise<void>((r) => app!.close(() => r()));
  }
  fs.rmSync(temporary, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
