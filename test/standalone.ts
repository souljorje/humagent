/** Acceptance checks use the relocated executable and the actual npm archives. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixtures';

interface Manifest {
  native: boolean;
  target: string;
  binary: string;
  applicationVersion: string;
  wrapperTarball: string;
  platformTarball: string;
  wrapperPackageName: string;
  platformPackageName: string;
  sizeBytes: number;
}
interface Record {
  pid: number;
  origin: string;
  token: string;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest: Manifest = await Bun.file(
  path.join(root, '.local/standalone/manifest.json'),
).json();
assert.equal(manifest.native, true, 'Acceptance requires a native executable.');
const directory = fixture('standalone');
const relocated = path.join(
  directory,
  `relocated humagent${process.platform === 'win32' ? '.exe' : ''}`,
);
fs.copyFileSync(manifest.binary, relocated);
fs.chmodSync(relocated, 0o755);
const env = {
  ...process.env,
  HUMAGENT_TEST_EXECUTABLE: relocated,
  HUMAGENT_TEST_VERSION: manifest.applicationVersion,
};
const checks: string[] = [];

function required(executable: string) {
  const resolved = Bun.which(executable);
  assert.ok(resolved, `${executable} is required to run acceptance checks.`);
  return resolved;
}

async function run(command: string[], cwd = root, expected = 0) {
  const child = Bun.spawn(command, {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill(), 180000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    assert.equal(code, expected, `${command.join(' ')}\n${stdout}\n${stderr}`);
    if (stdout) console.log(stdout.trimEnd());
    if (stderr) console.error(stderr.trimEnd());
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

function serverRecord(home: string): Record | undefined {
  try {
    const value = JSON.parse(
      fs.readFileSync(path.join(home, 'server.json'), 'utf8'),
    );
    return typeof value.origin === 'string' && typeof value.token === 'string'
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Check application cleanup when a signal reaches the executable or npm launcher. */
async function foreground(command: string[], signal?: 'SIGINT' | 'SIGTERM') {
  const home = fs.mkdtempSync(path.join(directory, 'foreground state '));
  const child = Bun.spawn([...command, 'server', '--home', home, '--json'], {
    cwd: directory,
    env: { ...env, PATH: '', Path: '', HUMAGENT_PORT: '0' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    let record: Record | undefined;
    for (let n = 0; n < 200 && !record; n++) {
      record = serverRecord(home);
      if (!record) await Bun.sleep(25);
    }
    assert.ok(record, 'The foreground server must publish its address.');
    assert.equal((await fetch(`${record.origin}/health`)).status, 200);
    if (signal) child.kill(signal);
    else {
      const response = await fetch(`${record.origin}/api/stop`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${record.token}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      assert.equal(response.status, 200);
    }
    assert.equal(await child.exited, 0, `${await stdout}\n${await stderr}`);
    assert.equal(fs.existsSync(path.join(home, 'server.json')), false);
    checks.push(
      `${command.length === 1 ? 'binary' : 'npm launcher'} ${signal ?? 'stop'} cleanup`,
    );
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    const record = serverRecord(home);
    if (record) {
      try {
        process.kill(record.pid, 'SIGKILL');
      } catch {}
    }
  }
}

function npmCommand() {
  const node = required('node');
  const npm = required(process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const cli =
    process.platform === 'win32'
      ? path.join(path.dirname(npm), 'node_modules/npm/bin/npm-cli.js')
      : fs.realpathSync(npm);
  assert.ok(fs.existsSync(cli), `Missing npm CLI: ${cli}`);
  return [node, cli];
}

async function npmAcceptance() {
  const install = path.join(directory, 'npm installation');
  fs.mkdirSync(install);
  fs.writeFileSync(
    path.join(install, 'package.json'),
    JSON.stringify({ name: 'standalone-acceptance', private: true }),
  );
  const npm = npmCommand();
  await run(
    [
      ...npm,
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      manifest.platformTarball,
      manifest.wrapperTarball,
    ],
    install,
  );
  const launcher = path.join(
    install,
    'node_modules',
    manifest.wrapperPackageName,
    'bin/launcher.cjs',
  );
  const command = [required('node'), launcher];
  assert.equal(
    (await run([...command, '--version'], install)).trim(),
    manifest.applicationVersion,
  );
  const home = path.join(install, 'state with spaces');
  const status = JSON.parse(
    await run([...command, 'status', '--home', home, '--json'], install),
  );
  assert.equal(status.runtime, 'bun');
  assert.equal(status.filesPresent, true);
  assert.equal(status.dataDirectory, home);
  await run([...command, '--unknown'], install, 1);
  const viaNpm = await run(
    [...npm, 'exec', '--offline', '--', 'humagent', '--version'],
    install,
  );
  assert.equal(viaNpm.trim(), manifest.applicationVersion);
  checks.push(
    'npm archives install offline with scripts disabled; npm exec, arguments, and exit status',
  );
  await foreground(
    command,
    process.platform === 'win32' ? undefined : 'SIGTERM',
  );
  if (process.platform !== 'win32') await foreground(command, 'SIGINT');

  const missing = path.join(directory, 'missing-launcher.cjs');
  fs.copyFileSync(launcher, missing);
  await run([required('node'), missing, '--version'], directory, 1);
  checks.push('missing platform package reports failure');
}

try {
  await run([
    process.execPath,
    'test',
    'test/cli.test.ts',
    '--timeout',
    '30000',
  ]);
  checks.push(
    'relocated binary: CLI session, receipt, persistence, restart, demo, help, version, and assets with empty PATH',
  );
  await foreground(
    [relocated],
    process.platform === 'win32' ? undefined : 'SIGTERM',
  );
  if (process.platform !== 'win32') await foreground([relocated], 'SIGINT');
  await npmAcceptance();
  if (!process.argv.includes('--skip-browser')) {
    await run([
      required('node'),
      path.join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      'test/playwright.config.ts',
    ]);
    checks.push('all browser workflows against the relocated binary');
  }
  const report = {
    target: manifest.target,
    sizeBytes: manifest.sizeBytes,
    checks,
    browser: process.argv.includes('--skip-browser') ? 'skipped' : 'passed',
  };
  fs.writeFileSync(
    path.join(path.dirname(manifest.binary), 'acceptance.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
