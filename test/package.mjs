import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixtures.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { assertReadmeAttribution } from './attribution.mjs';

const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const archive = path.resolve(
  process.env.HUMAGENT_TEST_ARCHIVE ??
    `${manifest.name}-${manifest.version}.tgz`,
);
assert.ok(fs.existsSync(archive), 'Run bun pm pack first');
const directory = fixture('package');
try {
  execFileSync('tar', ['-xzf', archive, '-C', directory]);
  const root = path.join(directory, 'package');
  const packaged = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(root, 'src')), false);
  assert.equal(fs.existsSync(path.join(root, '.github')), false);
  assert.equal(fs.existsSync(path.join(root, '.local')), false);
  for (const script of ['prepare', 'preinstall', 'install', 'postinstall'])
    assert.equal(
      packaged.scripts?.[script],
      undefined,
      `Unexpected install hook: ${script}`,
    );
  assert.deepEqual(packaged.dependencies, manifest.dependencies);
  assert.equal(Object.keys(packaged.dependencies).length, 2);
  assert.equal(packaged.engines.node, '>=24');
  for (const file of [
    'web/index.html',
    'web/sdk.js',
    'web/json.js',
    'web/targets.js',
    'examples/plan.html',
    'skills/humagent/SKILL.md',
    'docs/CLI.md',
    'docs/SDK.md',
    'docs/SECURITY.md',
    'LICENSE',
    'README.md',
  ])
    assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.equal(
    fs.existsSync(path.join(root, 'web/selection/anchors.js')),
    false,
  );
  assert.equal(fs.existsSync(path.join(root, 'web/vendor')), false);
  for (const entry of Object.values(packaged.exports)) {
    for (const file of Object.values(entry))
      assert.ok(
        fs.existsSync(path.join(root, file)),
        `Missing export: ${file}`,
      );
  }
  // Check documentation from the archive, where repository-only links can break.
  for (const file of fs
    .readdirSync(root, { recursive: true })
    .filter((file) => file.endsWith('.md'))) {
    const document = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, link] of document.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(link)) continue;
      const destination = path.resolve(
        root,
        path.dirname(file),
        link.split('#')[0],
      );
      assert.ok(
        fs.existsSync(destination),
        `Broken documentation link in ${file}: ${link}`,
      );
    }
  }
  assertReadmeAttribution(root);

  fs.writeFileSync(
    path.join(directory, 'package.json'),
    '{"name":"package-fixture","private":true}',
  );
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(
    npm,
    [
      'install',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      archive,
    ],
    {
      cwd: directory,
      env: { ...process.env, npm_config_cache: path.join(directory, 'cache') },
      timeout: 90000,
      shell: process.platform === 'win32',
    },
  );
  const installed = path.join(directory, 'node_modules', manifest.name);
  const require = createRequire(path.join(installed, 'package.json'));
  for (const name of Object.keys(packaged.dependencies)) {
    const resolved = require.resolve(name);
    assert.ok(
      !path
        .relative(path.join(directory, 'node_modules'), resolved)
        .startsWith('..'),
      `Runtime dependency resolved outside the installation: ${name}`,
    );
  }
  const cli = path.join(installed, 'dist', 'cli.js');
  assert.ok(fs.readFileSync(cli, 'utf8').startsWith('#!/usr/bin/env node\n'));
  const help = execFileSync(process.execPath, [cli, '--help'], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.match(help, /humagent demo/);
  assert.match(help, /Node.js 24/);
  assert.equal(
    execFileSync(process.execPath, [cli, '--version'], {
      encoding: 'utf8',
    }).trim(),
    manifest.version,
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import assert from 'node:assert/strict'; import {createRuntime} from 'humagent'; import {PROTOCOL} from 'humagent/protocol'; assert.equal(typeof createRuntime, 'function'); assert.equal(PROTOCOL, 1);",
    ],
    { cwd: installed, timeout: 10000 },
  );
  console.log(
    `PASS compiled package runs with ${process.versions.bun ? 'Bun' : 'Node.js'} without development dependencies`,
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
