/** The browser suite can use the package or a relocated standalone executable. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'humagent';

type Runtime = Awaited<ReturnType<typeof createServer>>;
type Session = ReturnType<Runtime['store']['get']>;
interface Record {
  pid: number;
  origin: string;
  token: string;
}

function record(directory: string): Record | undefined {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(directory, 'server.json'), 'utf8'),
    );
  } catch {
    return undefined;
  }
}

async function waitForExit(child: ChildProcess) {
  for (
    let n = 0;
    n < 200 && child.exitCode === null && child.signalCode === null;
    n++
  )
    await new Promise((resolve) => setTimeout(resolve, 25));
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    throw new Error('The standalone server did not stop within five seconds.');
  }
}

async function stop(child: ChildProcess, { origin, token }: Record) {
  try {
    const response = await fetch(`${origin}/api/stop`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    await waitForExit(child);
    assert.equal(child.exitCode, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
  }
}

async function standaloneServer(executable: string, directory: string) {
  const child = spawn(executable, ['server', '--home', directory, '--json'], {
    cwd: path.dirname(directory),
    env: { ...process.env, PATH: '', Path: '', HUMAGENT_PORT: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let errors = '';
  child.stderr?.on('data', (chunk) => {
    errors += chunk;
  });
  child.on('error', (error) => {
    errors += String(error);
  });
  for (let n = 0; n < 200; n++) {
    const saved = record(directory);
    if (
      saved &&
      saved.pid === child.pid &&
      typeof saved.origin === 'string' &&
      typeof saved.token === 'string'
    ) {
      return {
        origin: saved.origin,
        token: saved.token,
        store: {
          get: (id: string): Session =>
            JSON.parse(
              fs.readFileSync(
                path.join(directory, 'sessions', `${id}.json`),
                'utf8',
              ),
            ).session,
        },
        close: () => stop(child, saved),
      };
    }
    if (child.exitCode !== null || child.signalCode !== null || errors) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  child.kill('SIGKILL');
  throw new Error(`The standalone server did not start: ${errors}`);
}

export function testServer(directory: string) {
  const executable = process.env.HUMAGENT_TEST_EXECUTABLE;
  return executable
    ? standaloneServer(executable, directory)
    : createServer({ directory });
}
