import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { assertReadmeAttribution } from './attribution.mjs';
const root = path.resolve(import.meta.dir, '..');
const cli = path.join(root, 'dist/cli.js');
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);

test('CLI provides help and version without starting a server', () => {
  const home = fixture('help');
  try {
    const run = (args) =>
      execFileSync(process.execPath, [cli, ...args, '--home', home], {
        encoding: 'utf8',
      });
    assert.match(run(['-h']), /humagent demo/);
    assert.equal(run(['--version']).trim(), pkg.version);
    assert.equal(JSON.parse(run(['--version', '--json'])).version, pkg.version);
    for (const args of [
      ['unknown'],
      ['open', '--bad'],
      ['reply', 'id', '--message'],
      ['wait', 'id', '--timeout', '0'],
    ]) {
      assert.throws(() => run(args));
      assert.equal(fs.existsSync(path.join(home, 'server.json')), false);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
test('CLI rejects Node versions below 24', () => {
  const home = fixture('node-version');
  const bootstrap = `
    import { pathToFileURL } from 'node:url';
    const [, version, cli, home] = process.argv;
    Object.defineProperty(process.versions, 'node', { value: version });
    process.argv = [process.execPath, cli, 'doctor', '--home', home, '--json'];
    await import(pathToFileURL(cli).href);
  `;
  try {
    for (const version of ['22.0.0', '23.0.0', '24.0.0', '25.0.0']) {
      const result = spawnSync(
        'node',
        ['--input-type=module', '--eval', bootstrap, version, cli, home],
        { encoding: 'utf8', timeout: 10000 },
      );
      assert.ifError(result.error);
      const output = JSON.parse(result.stdout);
      if (Number(version.split('.')[0]) < 24) {
        assert.equal(result.status, 1);
        assert.match(output.error, /Use Node\.js 24 or later/);
      } else {
        assert.equal(result.status, 0);
        assert.equal(output.runtime, 'node');
      }
    }
    assert.equal(fs.existsSync(path.join(home, 'server.json')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
test('skill setup is repeatable and preserves edits', () => {
  const directory = fixture('skill');
  try {
    const run = (...args) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [cli, 'setup', '--directory', directory, '--json', ...args],
          { encoding: 'utf8' },
        ),
      );
    run();
    assert.equal(run().unchanged, true);
    const file = path.join(directory, 'SKILL.md');
    fs.appendFileSync(file, '\nCustom instruction.\n');
    assert.throws(() => run());
    assert.match(fs.readFileSync(file, 'utf8'), /Custom instruction/);
    run('--force');
    assert.ok(!fs.readFileSync(file, 'utf8').includes('Custom instruction.'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test('package metadata has no installation build hooks', () => {
  for (const hook of ['prepare', 'preinstall', 'install', 'postinstall'])
    assert.equal(pkg.scripts[hook], undefined);
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.bin.humagent, 'dist/cli.js');
  assert.equal(pkg.packageManager, 'bun@1.4.4');
  assert.equal(pkg.engines.node, '>=24');
});
test('upstream names and full license notices stay only in the root README', () => {
  assertReadmeAttribution(root);
});
test('attribution checks catch names in source, build output, and nested READMEs', () => {
  const directory = fixture('attribution');
  try {
    for (const file of [
      'README.md',
      'LICENSE',
      'package.json',
      'web/selection/targets.js',
    ]) {
      const destination = path.join(directory, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, file), destination);
    }
    const identifiers = assertReadmeAttribution(directory);
    for (const relative of [
      'source.js',
      'dist/source.js',
      'nested/README.md',
    ]) {
      const file = path.join(directory, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      for (const identifier of identifiers) {
        fs.writeFileSync(file, identifier);
        assert.throws(
          () => assertReadmeAttribution(directory),
          /Credit outside README/,
        );
      }
      fs.rmSync(file);
    }
    const readme = path.join(directory, 'README.md');
    fs.writeFileSync(
      readme,
      fs
        .readFileSync(readme, 'utf8')
        .replace('Permission is hereby granted', 'Notice removed'),
    );
    assert.throws(
      () => assertReadmeAttribution(directory),
      /Full MIT notice missing/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
