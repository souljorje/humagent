import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { fixture } from './fixtures.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

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
          protocol: 1,
          clientId: 'bun-cli-test',
          kind: 'message',
          revision: snapshot.revision,
          payload: { text: 'Check this interface.' },
        }),
      },
    );
    assert.equal(response.status, 200);
    const batch = await pending;
    assert.equal(batch.status, 'feedback');
    assert.equal(batch.events[0].payload.text, 'Check this interface.');
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
