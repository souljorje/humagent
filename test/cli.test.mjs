import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { fixture } from './fixtures.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('Bun CLI preserves runtime and origin through an agent loop and restart', async () => {
  assert.ok(process.versions.bun, 'Run this suite with Bun');
  const root = fixture('cli');
  const home = path.join(root, 'state');
  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(artifacts);
  const source = path.join(artifacts, 'index.html');
  fs.writeFileSync(source, '<!doctype html><h1>CLI test</h1>');
  const env = { ...process.env };
  delete env.HUMAGENT_PORT;
  const run = async (...args) => {
    const { stdout } = await execute(
      process.execPath,
      [cli, ...args, '--home', home],
      {
        env,
        timeout: 10000,
      },
    );
    return JSON.parse(stdout);
  };
  async function stop() {
    await run('stop');
    for (
      let i = 0;
      i < 100 && fs.existsSync(path.join(home, 'server.lock'));
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(
      fs.existsSync(path.join(home, 'server.lock')),
      false,
      'Server must stop before cleanup',
    );
  }
  try {
    const opened = await run('open', source, '--no-open');
    assert.ok(opened.session);
    const record = JSON.parse(
      fs.readFileSync(path.join(home, 'server.json'), 'utf8'),
    );
    const started = JSON.parse(
      fs.readFileSync(path.join(home, 'server.log'), 'utf8').trim(),
    );
    assert.equal(started.runtime, 'bun');
    assert.equal(started.runtimeVersion, process.versions.bun);
    const snapshot = await run('status', opened.session);
    const pending = run(
      'wait',
      opened.session,
      '--consumer',
      'bun-test',
      '--timeout',
      '2',
      '--lease',
      '600',
    );
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
          clientId: 'bun-cli-test',
          revision: snapshot.revision,
          payload: { message: 'Check this interface.', items: [] },
        }),
      },
    );
    assert.equal(response.status, 200);
    const batch = await pending;
    assert.equal(batch.status, 'feedback');
    assert.equal(batch.events[0].payload.message, 'Check this interface.');
    await run(
      'renew',
      opened.session,
      '--receipt',
      batch.receipt,
      '--lease',
      '600',
    );
    await run(
      'reply',
      opened.session,
      '--receipt',
      batch.receipt,
      '--message',
      'Checked. No source changes.',
    );
    const result = await run('status', opened.session);
    assert.equal(result.events[0].status, 'completed');
    assert.equal(result.replies[0].text, 'Checked. No source changes.');
    await stop();
    const resumed = await run('open', source, '--no-open');
    assert.equal(resumed.session, opened.session);
    assert.equal(new URL(resumed.url).origin, new URL(opened.url).origin);
    assert.equal(
      (await run('status', opened.session)).replies[0].text,
      'Checked. No source changes.',
    );
    const skills = path.join(root, 'skills', 'humagent');
    await run('setup', '--directory', skills);
    assert.match(
      fs.readFileSync(path.join(skills, 'SKILL.md'), 'utf8'),
      /Humagent/,
    );
    await run('end', opened.session);
    assert.equal(
      (await run('wait', opened.session, '--timeout', '1')).status,
      'ended',
    );
  } finally {
    await stop();
    assert.equal((await run('stop')).alreadyStopped, true);
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 15000);

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
      ['constructor'],
      ['__proto__'],
      ['toString'],
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
