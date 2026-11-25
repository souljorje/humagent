import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from '@/server/client';
import { version } from '@/server/version';
import { ensure } from '@/shared/validate';

/** Check every 100 ms until `check` returns a value, at most `attempts` times. */
async function poll<T>(check: () => Promise<T | null>, attempts: number) {
  for (let n = 0; n < attempts; n++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const value = await check();
    if (value) return value;
  }
  return null;
}
/** Return a client of this directory's server. Start the server when none runs. */
export async function service(directory: string) {
  const existing = await connect(directory);
  if (existing) {
    ensure(
      existing.version === version,
      'An older server is running. Run humagent stop, then repeat this command. Saved sessions remain available.',
    );
    return existing;
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(directory, 'server.log'), 'a', 0o600);
  // Keep the selected runtime for the detached server, including bunx --bun.
  const child = spawn(
    process.execPath,
    [process.argv[1]!, 'server', '--home', directory, '--json'],
    {
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
    },
  );
  child.on('error', () => {});
  child.unref();
  fs.closeSync(log);
  const started = await poll(() => connect(directory), 80);
  ensure(
    started,
    `Could not start the server. Read ${path.join(directory, 'server.log')}.`,
  );
  ensure(
    started.version === version,
    'Another server version started. Run humagent stop, then retry.',
  );
  return started;
}
