import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { fixture } from './fixtures.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/** Run JSON CLI commands against one home and stop its server. */
function cliRunner(home: string, env: NodeJS.ProcessEnv) {
  const run = async (...args: string[]) =>
    JSON.parse(
      (
        await execute(process.execPath, [cli, ...args, '--home', home], {
          env,
          timeout: 10000,
        })
      ).stdout,
    );
  async function stop() {
    await run('stop');
    for (
      let i = 0;
      i < 100 && fs.existsSync(path.join(home, 'server.json'));
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      fs.existsSync(path.join(home, 'server.json')),
      false,
      'Server must stop before cleanup',
    );
  }
  return { run, stop };
}

test('Bun CLI preserves runtime and sessions through an agent loop and restart', async () => {
  assert.ok(process.versions.bun, 'Run this suite with Bun');
  const root = fixture('cli');
  const home = path.join(root, 'state');
  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(artifacts);
  const source = path.join(artifacts, 'index.html');
  fs.writeFileSync(source, '<!doctype html><h1>CLI test</h1>');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.HUMAGENT_PORT;
  const { run, stop } = cliRunner(home, env);
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
    const pending = run('wait', opened.session);
    for (
      let attempt = 0;
      (await run('status', opened.session)).agent !== 'waiting';
      attempt++
    ) {
      assert.ok(attempt < 50, 'Agent must start waiting');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const browser = (action: string, method: string, data: unknown) =>
      fetch(`${record.origin}/api/sessions/${opened.session}/${action}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-humagent-session': new URL(opened.url).hash.slice(1),
        },
        body: JSON.stringify(data),
      });
    await browser('message', 'PUT', { text: 'Check this interface.' });
    const response = await browser('send', 'POST', {
      revision: snapshot.revision,
    });
    assert.equal(response.status, 200);
    const batch = await pending;
    assert.equal(batch.status, 'feedback');
    assert.equal(batch.events[0].message, 'Check this interface.');
    await run('ack', opened.session, '--receipt', batch.receipt);
    assert.equal((await run('status', opened.session)).agent, 'idle');
    await stop();
    const resumed = await run('open', source, '--no-open');
    assert.equal(resumed.session, opened.session);
    assert.equal((await run('status', opened.session)).agent, 'idle');
    await run('end', opened.session);
    assert.equal((await run('wait', opened.session)).status, 'ended');
  } finally {
    await stop();
    assert.equal((await run('stop')).alreadyStopped, true);
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 15000);

test('CLI provides help and version without starting a server', () => {
  const home = fixture('help');
  try {
    const run = (args: string[]) =>
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
      ['ack', 'id', '--receipt'],
      ['wait', 'id', '--timeout', '1'],
      ['renew', 'id'],
      ['setup'],
      ['demo', 'plan'],
      ['demo', 'calculator'],
      ['demo', 'existing'],
    ]) {
      assert.throws(() => run(args));
      assert.equal(fs.existsSync(path.join(home, 'server.json')), false);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('demo serves only the editable plan and preserves existing user copies', async () => {
  const home = fixture('plan-demo');
  const old = path.join(home, 'demos', pkg.version);
  fs.mkdirSync(old, { recursive: true });
  const previous = path.join(old, 'plan.html');
  fs.writeFileSync(previous, '<h1>A saved user plan</h1>');
  fs.writeFileSync(
    path.join(old, 'existing.html'),
    '<h1>An older demo copy</h1>',
  );
  const { run, stop } = cliRunner(home, {
    ...process.env,
    HUMAGENT_PORT: '0',
  });
  try {
    const opened = await run('demo', '--no-open');
    const snapshot = await run('status', opened.session);
    assert.equal(snapshot.target.value, path.join(old, 'plan', 'plan.html'));
    assert.deepEqual(
      fs.readdirSync(path.dirname(snapshot.target.value)).sort(),
      ['plan.css', 'plan.html'],
    );
    assert.match(
      await (await fetch(snapshot.surface.frameUrl)).text(),
      /Show your agent what you mean/,
    );
    assert.equal(
      (await fetch(new URL('existing.html', snapshot.surface.frameUrl))).ok,
      false,
    );
    fs.appendFileSync(snapshot.target.value, '\n<!-- Local demo edit -->');
    assert.equal((await run('demo', '--no-open')).session, opened.session);
    assert.match(
      fs.readFileSync(snapshot.target.value, 'utf8'),
      /Local demo edit/,
    );
    assert.equal(
      fs.readFileSync(previous, 'utf8'),
      '<h1>A saved user plan</h1>',
    );
  } finally {
    await stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
test('CLI rejects Node versions below 24', () => {
  const home = fixture('node-version');
  const bootstrap = fileURLToPath(
    new URL('./helpers/node-version.ts', import.meta.url),
  );
  try {
    for (const version of ['22.0.0', '23.0.0', '24.0.0', '25.0.0']) {
      const result = spawnSync('node', [bootstrap, version, cli, home], {
        encoding: 'utf8',
        timeout: 10000,
      });
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
