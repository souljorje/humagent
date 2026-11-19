import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixtures.ts';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/** Run JSON CLI commands against one home with one runtime executable. */
function cliRunner(home: string, executable = process.execPath) {
  const env = { ...process.env, HUMAGENT_PORT: '0' };
  const run = async (...args: string[]) =>
    JSON.parse(
      (
        await execute(executable, [cli, ...args, '--home', home], {
          env,
          timeout: 10000,
        })
      ).stdout,
    );
  /** Stop the server and wait until it removes its record. */
  async function stop() {
    await run('stop');
    const record = path.join(home, 'server.json');
    for (let i = 0; i < 100 && fs.existsSync(record); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fs.existsSync(record), false, 'Server must stop');
  }
  return { run, stop };
}

for (const runtime of ['bun', 'node'])
  test(`the ${runtime} CLI keeps a session through an agent loop and a server restart`, async () => {
    const root = fixture(`cli-${runtime}`);
    const home = path.join(root, 'state');
    // The page stays outside the state directory.
    const source = path.join(root, 'artifacts/index.html');
    fs.mkdirSync(path.dirname(source));
    fs.writeFileSync(source, '<!doctype html><h1>CLI test</h1>');
    const { run, stop } = cliRunner(
      home,
      runtime === 'bun' ? process.execPath : 'node',
    );
    try {
      const opened = await run('open', source, '--no-open');
      const record = JSON.parse(
        fs.readFileSync(path.join(home, 'server.json'), 'utf8'),
      );
      // The child server uses the runtime of the CLI.
      const started = JSON.parse(
        fs.readFileSync(path.join(home, 'server.log'), 'utf8').trim(),
      );
      assert.equal(started.runtime, runtime);
      const snapshot = await run('status', opened.session);
      const pending = run('wait', opened.session);
      for (
        let attempt = 0;
        (await run('status', opened.session)).agent !== 'connected';
        attempt++
      )
        assert.ok(attempt < 50, 'Agent must start waiting');
      const browser = (action: string, method: string, data: unknown) =>
        fetch(`${record.origin}/api/sessions/${opened.session}/${action}`, {
          method,
          headers: {
            'content-type': 'application/json',
            'x-humagent-session': new URL(opened.url).hash.slice(1),
          },
          body: JSON.stringify(data),
        });
      await browser('instruction', 'PUT', {
        instruction: 'Check this interface.',
      });
      const sent = await browser('send', 'POST', {
        revision: snapshot.revision,
      });
      assert.equal(sent.status, 200);
      const batch = await pending;
      assert.equal(batch.status, 'feedback');
      assert.equal(batch.events[0].instruction, 'Check this interface.');
      assert.equal(batch.events[0].revision, snapshot.revision);
      assert.equal((await run('status', opened.session)).agent, 'sent');
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await run(
              'ack',
              opened.session,
              '--receipt',
              batch.receipt,
              '--start',
            )
          ).agent,
          'working',
        );

      // An unacknowledged event survives a restart. Only its newest receipt is valid.
      await stop();
      const resumed = await run('open', source, '--no-open');
      assert.equal(resumed.session, opened.session);
      assert.equal((await run('status', opened.session)).agent, 'sent');
      const redelivered = await run('wait', opened.session);
      assert.equal(redelivered.events[0].id, batch.events[0].id);
      assert.equal(redelivered.events[0].deliveries, 2);
      await assert.rejects(() =>
        run('ack', opened.session, '--receipt', batch.receipt),
      );
      await assert.rejects(() =>
        run('ack', opened.session, '--receipt', batch.receipt, '--start'),
      );
      assert.equal(
        (
          await run(
            'ack',
            opened.session,
            '--receipt',
            redelivered.receipt,
            '--start',
          )
        ).agent,
        'working',
      );
      await run('ack', opened.session, '--receipt', redelivered.receipt);
      assert.equal((await run('status', opened.session)).agent, 'idle');
      await run('end', opened.session);
      assert.equal((await run('wait', opened.session)).status, 'ended');
    } finally {
      await stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

test('the demo opens the editable plan and keeps local edits on the next run', async () => {
  const home = fixture('demo');
  const { run, stop } = cliRunner(home);
  try {
    const opened = await run('demo', '--no-open');
    const snapshot = await run('status', opened.session);
    assert.match(
      await (await fetch(snapshot.surface.frameUrl)).text(),
      /Show your agent what you mean/,
    );
    fs.appendFileSync(snapshot.source.value, '\n<!-- Local demo edit -->');
    assert.equal((await run('demo', '--no-open')).session, opened.session);
    assert.match(
      fs.readFileSync(snapshot.source.value, 'utf8'),
      /Local demo edit/,
    );
  } finally {
    await stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('help, version, invalid commands, and old Node versions do not start a server', () => {
  const home = fixture('help');
  const run = (args: string[]) =>
    execFileSync(process.execPath, [cli, ...args, '--home', home], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  // Load the CLI under Node.js with a replaced version number.
  const withNode = (version: string) =>
    spawnSync(
      'node',
      [
        '--input-type=module',
        '--eval',
        `Object.defineProperty(process.versions, 'node', { value: '${version}' });
         process.argv = [process.execPath, ${JSON.stringify(cli)}, 'status', '--home', ${JSON.stringify(home)}, '--json'];
         await import(${JSON.stringify(new URL('../dist/cli/index.js', import.meta.url).href)});`,
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
  try {
    assert.match(run(['--help']), /humagent demo/);
    assert.equal(run(['--version']).trim(), pkg.version);
    for (const args of [['unknown'], ['__proto__'], ['open', '--bad']])
      assert.throws(() => run(args));
    const old = withNode('23.0.0');
    assert.equal(old.status, 1);
    assert.match(JSON.parse(old.stdout).error, /Use Node\.js 24 or later/);
    const supported = withNode('24.0.0');
    assert.equal(supported.status, 0, supported.stderr);
    assert.equal(JSON.parse(supported.stdout).runtime, 'node');
    assert.equal(fs.existsSync(path.join(home, 'server.json')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
