import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { release } from 'node:os';

if (!process.versions.bun) throw new Error('Run checks with Bun.');

// Turbo writes task logs to .turbo. Keep their contents under .local.
mkdirSync('.local/turbo', { recursive: true });
if (!existsSync('.turbo')) symlinkSync('.local/turbo', '.turbo', 'junction');

const result = spawnSync(
  'turbo',
  [
    'run',
    'format:check',
    'lint',
    'build',
    'typecheck',
    'test:fast',
    '--output-logs=new-only',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      TURBO_CACHE: 'local:rw',
      HUMAGENT_CHECK_RUNTIME: [
        process.platform,
        process.arch,
        release(),
        process.versions.bun,
        execFileSync('node', ['--version'], { encoding: 'utf8' }).trim(),
      ].join('/'),
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
