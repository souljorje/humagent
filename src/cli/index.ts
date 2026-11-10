#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../runtime/server.js';
import { ensure } from '../runtime/validate.js';
import { LIMITS } from '../shared/feedback.js';
import { version, runtimeName, runtimeVersion } from '../runtime/version.js';

const HELP = `Humagent ${version}
Work with your agent through a page, prototype, or local application.

Start here:
  humagent demo                         Open the interactive plan guide
  humagent open ./page.html              Review an HTML file
  humagent open http://localhost:3000    Review a trusted local app
  humagent setup                        Install the agent skill for this project

Agent commands:
  humagent wait <session> [--consumer name] [--timeout seconds] [--lease seconds]
  humagent ack <session> --receipt id
  humagent renew <session> --receipt id [--lease seconds]

Session commands:
  humagent status [session]              Show sessions or one session
  humagent end <session>                 End a session
  humagent stop                          Stop the server and retain saved data
  humagent doctor                        Check the runtime and server

Options:
  --no-open                             Print the browser URL without opening it
  --network                             Allow external resources in trusted HTML
  --home <directory>                    Choose a private data directory
  --json                                Print machine-readable output
  -h, --help                            Show this help
  -v, --version                         Show the installed version

Also:
  humagent setup [--directory path] [--force]
  humagent server [--port number]

Run with Node.js 24+ or Bun 1.4.4+. Bun is not required for npm/npx use.
Humagent does not run a model or change source files.
The agent must run wait to receive browser input.
`;
const booleanFlags = new Set([
  'no-open',
  'network',
  'help',
  'version',
  'json',
  'force',
]);
const flags = new Map<string, string>();
const positional: string[] = [];
let directory = '';
let machine = !process.stdout.isTTY || process.argv.includes('--json');
function parse() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    let arg = args[i]!;
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '-h') arg = '--help';
    if (arg === '-v') arg = '--version';
    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    ensure(
      arg.startsWith('--'),
      `Unknown option: ${arg}. Run humagent --help.`,
    );
    const [name, ...inline] = arg.slice(2).split('=');
    const key = name!;
    ensure(!flags.has(key), `Do not repeat --${key}.`);
    if (booleanFlags.has(key)) {
      ensure(inline.length === 0, `--${key} does not accept a value.`);
      flags.set(key, 'true');
    } else {
      ensure(
        key === 'home' ||
          Object.values(commands).some((command) =>
            command.flags.includes(key),
          ),
        `Unknown option: --${key}.`,
      );
      const value = inline.length ? inline.join('=') : args[++i];
      ensure(
        value !== undefined && !value.startsWith('--'),
        `Provide a value for --${key}.`,
      );
      flags.set(key, value);
    }
  }
  directory = path.resolve(
    flags.get('home') ??
      process.env.HUMAGENT_HOME ??
      path.join(os.homedir(), '.humagent'),
  );
  machine ||= flags.has('json');
}
interface ServerRecord {
  pid: number;
  origin: string;
  token: string;
  version?: string;
}
function record(): ServerRecord | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(directory, 'server.json'), 'utf8'),
    );
  } catch {
    return null;
  }
}
async function alive(r: ServerRecord | null) {
  if (!r) return false;
  try {
    const res = await fetch(`${r.origin}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const info = (await res.json()) as { app?: string; pid?: number };
    return res.ok && info.app === 'humagent' && info.pid === r.pid;
  } catch {
    return false;
  }
}
async function service() {
  const existing = record();
  if (await alive(existing)) {
    ensure(
      existing!.version === version,
      'An older server is running. Run humagent stop, then repeat this command. Saved sessions remain available.',
    );
    return existing!;
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(directory, 'server.log'), 'a', 0o600);
  // Keep the selected runtime for the detached server, including bunx --bun.
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), 'server', '--home', directory, '--json'],
    {
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
    },
  );
  child.on('error', () => {});
  child.unref();
  fs.closeSync(log);
  for (let n = 0; n < 80; n++) {
    await new Promise((r) => setTimeout(r, 100));
    const current = record();
    if (await alive(current)) {
      ensure(
        current!.version === version,
        'Another server version started. Run humagent stop, then retry.',
      );
      return current!;
    }
  }
  throw new Error(
    `Could not start the server. Read ${path.join(directory, 'server.log')}.`,
  );
}
async function request(
  r: ServerRecord,
  route: string,
  method = 'GET',
  data?: unknown,
  timeout = 65000,
) {
  const response = await fetch(r.origin + route, {
    method,
    headers: {
      authorization: `Bearer ${r.token}`,
      'content-type': 'application/json',
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(timeout),
  });
  const result = (await response.json()) as {
    message?: string;
    error?: string;
  };
  if (!response.ok) throw new Error(`${result.error}: ${result.message}`);
  return result;
}
async function output(value: unknown) {
  await new Promise<void>((resolve) =>
    process.stdout.write(JSON.stringify(value, null, 2) + '\n', () =>
      resolve(),
    ),
  );
}
/** Read a duration flag in seconds and return milliseconds. */
function duration(name: 'timeout' | 'lease') {
  const {
    default: fallback,
    min,
    max,
  } = name === 'lease' ? LIMITS.leaseMs : LIMITS.waitMs;
  const value = Math.round(Number(flags.get(name) ?? fallback / 1000) * 1000);
  ensure(
    Number.isFinite(value) && value >= min && value <= max,
    `--${name} must be between ${min / 1000} and ${max / 1000} seconds.`,
  );
  return value;
}
function openBrowser(url: string) {
  const [exe, parameters] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  const child = spawn(exe as string, parameters as string[], {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.on('error', () =>
    process.stderr.write(
      'The browser did not open. Open the printed URL manually.\n',
    ),
  );
  child.unref();
}
function sessionRoute(argument: string | undefined) {
  ensure(
    argument && /^[\w-]+$/.test(argument),
    'Specify a session ID from the open command.',
  );
  return `/api/sessions/${argument}`;
}
async function openTarget(target: string) {
  const result = (await request(await service(), '/api/open', 'POST', {
    target,
    network: flags.has('network'),
  })) as { url: string; session: string; note: string };
  if (!flags.has('no-open')) openBrowser(result.url);
  if (machine) await output(result);
  else
    console.log(
      `Open this private URL in your browser:\n${result.url}\n\nSession: ${result.session}\nSource: ${target}\n\nAsk your agent to run:\n  humagent wait ${result.session}\n\n${result.note}\nNo agent is connected until it starts waiting.`,
    );
}
interface Command {
  flags: string[];
  /** Whether the command accepts one positional argument. */
  argument: boolean;
  run(argument: string | undefined): Promise<void>;
}
/** Every command validates its input before it starts the server. */
const commands: Record<string, Command> = {
  open: {
    flags: ['no-open', 'network'],
    argument: true,
    async run(argument) {
      ensure(
        argument,
        'Specify an HTML file or localhost URL. Example: humagent open ./page.html',
      );
      const target = /^https?:/i.test(argument)
        ? argument
        : path.resolve(argument);
      if (!/^https?:/i.test(target))
        ensure(fs.existsSync(target), `File not found: ${target}`);
      await openTarget(target);
    },
  },
  demo: {
    flags: ['no-open', 'network'],
    argument: false,
    async run() {
      const destination = path.join(directory, 'demos', version, 'plan');
      fs.mkdirSync(destination, { recursive: true });
      for (const file of ['plan.html', 'plan.css']) {
        const to = path.join(destination, file);
        if (!fs.existsSync(to))
          fs.copyFileSync(new URL(`../examples/${file}`, import.meta.url), to);
      }
      await openTarget(path.join(destination, 'plan.html'));
    },
  },
  wait: {
    flags: ['consumer', 'timeout', 'lease'],
    argument: true,
    async run(argument) {
      const route = sessionRoute(argument);
      const timeoutMs = duration('timeout'),
        leaseMs = duration('lease');
      const r = await service();
      process.stderr.write(
        'Waiting for input. Keep this command attached to the active agent turn.\n',
      );
      await output(
        await request(
          r,
          `${route}/wait`,
          'POST',
          { consumer: flags.get('consumer') ?? 'agent', timeoutMs, leaseMs },
          timeoutMs + 5000,
        ),
      );
    },
  },
  ack: {
    flags: ['receipt'],
    argument: true,
    async run(argument) {
      const route = sessionRoute(argument);
      ensure(flags.get('receipt'), '--receipt is required.');
      await output(
        await request(await service(), `${route}/ack`, 'POST', {
          receipt: flags.get('receipt'),
        }),
      );
    },
  },
  renew: {
    flags: ['receipt', 'lease'],
    argument: true,
    async run(argument) {
      const route = sessionRoute(argument);
      ensure(flags.get('receipt'), '--receipt is required.');
      const leaseMs = duration('lease');
      await output(
        await request(await service(), `${route}/renew`, 'POST', {
          receipt: flags.get('receipt'),
          leaseMs,
        }),
      );
    },
  },
  status: {
    flags: [],
    argument: true,
    async run(argument) {
      if (!(await alive(record()))) {
        await output({
          serverRunning: false,
          note: 'The server is stopped. Use open to resume a saved target.',
        });
        return;
      }
      const route = argument ? sessionRoute(argument) : '/api/sessions';
      await output(await request(await service(), route));
    },
  },
  end: {
    flags: [],
    argument: true,
    async run(argument) {
      const route = sessionRoute(argument);
      await output(await request(await service(), `${route}/end`, 'POST', {}));
    },
  },
  stop: {
    flags: [],
    argument: false,
    async run() {
      const r = record();
      if (!(await alive(r))) {
        await output({ stopped: true, alreadyStopped: true });
        return;
      }
      await output(await request(r!, '/api/stop', 'POST', {}));
    },
  },
  doctor: {
    flags: [],
    argument: false,
    async run() {
      const r = record();
      await output({
        version,
        runtime: runtimeName,
        runtimeVersion,
        dataDirectory: directory,
        serverRunning: await alive(r),
        serverVersion: r?.version ?? null,
        filesPresent: [
          '../ui/index.html',
          '../sdk/sdk.js',
          '../../skills/humagent/SKILL.md',
        ].every((p) => fs.existsSync(new URL(p, import.meta.url))),
      });
    },
  },
  setup: {
    flags: ['directory', 'force'],
    argument: false,
    async run() {
      const destination = path.resolve(
        flags.get('directory') ?? '.agents/skills/humagent',
      );
      const file = path.join(destination, 'SKILL.md');
      const skill = fs.readFileSync(
        new URL('../../skills/humagent/SKILL.md', import.meta.url),
        'utf8',
      );
      if (fs.existsSync(file)) {
        if (fs.readFileSync(file, 'utf8') === skill) {
          await output({ installed: file, unchanged: true });
          return;
        }
        ensure(
          flags.has('force'),
          'The skill contains different text. Preserve your changes or use --force to replace it.',
        );
      }
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(file, skill);
      if (machine) await output({ installed: file });
      else
        console.log(
          `Installed the agent skill:\n${file}\n\nAsk your agent to read it before starting a session.`,
        );
    },
  },
  server: {
    flags: ['port'],
    argument: false,
    async run() {
      const configuredPort = flags.get('port') ?? process.env.HUMAGENT_PORT;
      const port =
        configuredPort === undefined ? undefined : Number(configuredPort);
      ensure(
        port === undefined ||
          (Number.isInteger(port) && port >= 0 && port <= 65535),
        'The server port must be an integer from 0 to 65535.',
      );
      const runtime = await createRuntime({ directory, port });
      await output({
        status: 'listening',
        origin: runtime.origin,
        runtime: runtimeName,
        runtimeVersion,
        version,
      });
      for (const signal of ['SIGTERM', 'SIGINT'] as const)
        process.on(signal, () => {
          void runtime.close().then(() => process.exit(0));
        });
    },
  },
};
async function main() {
  parse();
  if (flags.has('version')) {
    if (flags.has('json')) await output({ version });
    else console.log(version);
    return;
  }
  const [name, argument] = positional;
  if (!name || name === 'help' || flags.has('help')) {
    console.log(HELP);
    return;
  }
  ensure(
    Object.hasOwn(commands, name),
    `Unknown command: ${name}. Run humagent --help.`,
  );
  const command = commands[name]!;
  ensure(
    positional.length <= 2,
    'Too many arguments. Quote file paths that contain spaces.',
  );
  for (const key of flags.keys())
    ensure(
      ['home', 'json'].includes(key) || command.flags.includes(key),
      `--${key} is not valid for ${name}.`,
    );
  if (!command.argument)
    ensure(!argument, `${name} does not accept a positional argument.`);
  if (runtimeName === 'node')
    ensure(
      Number(process.versions.node.split('.')[0]) >= 24,
      'Use Node.js 24 or later, or run this command with Bun 1.4.4 or later.',
    );
  await command.run(argument);
}
main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (machine) await output({ error: message });
  else process.stderr.write(`Humagent: ${message}\n`);
  process.exitCode = 1;
});
