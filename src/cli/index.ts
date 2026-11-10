#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../runtime/server.js';
import { ensure } from '../runtime/validate.js';
import { version, runtimeName, runtimeVersion } from '../runtime/version.js';

const HELP = `Humagent ${version}
Work with your agent through a page, prototype, or local application.

Start here:
  humagent demo                         Open the interactive plan guide
  humagent open ./page.html              Review an HTML file
  humagent open http://localhost:3000    Review a trusted local app
  humagent setup                        Install the agent skill for this project

Agent commands:
  humagent wait <session>                Wait until the user sends feedback
  humagent ack <session> --receipt id    Complete the events of a receipt

Session commands:
  humagent status [session]              Show the runtime, sessions, or one session
  humagent end <session>                 End a session
  humagent stop                          Stop the server and retain saved data

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
/** Return the server record only when that server answers its health check. */
async function running(r = record()) {
  if (!r) return null;
  try {
    const res = await fetch(`${r.origin}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const info = (await res.json()) as { app?: string; pid?: number };
    return res.ok && info.app === 'humagent' && info.pid === r.pid ? r : null;
  } catch {
    return null;
  }
}
async function service() {
  const existing = await running();
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
  const started = await poll(() => running(), 80);
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
/** Check every 100 ms until `check` returns a value, at most `attempts` times. */
async function poll<T>(check: () => Promise<T | null>, attempts: number) {
  for (let n = 0; n < attempts; n++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const value = await check();
    if (value) return value;
  }
  return null;
}
async function request(
  r: ServerRecord,
  route: string,
  method = 'GET',
  data?: unknown,
  /** Zero waits without a limit. */
  timeout = 65000,
) {
  const response = await fetch(r.origin + route, {
    method,
    headers: {
      authorization: `Bearer ${r.token}`,
      'content-type': 'application/json',
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
  });
  const result = (await response.json()) as {
    message?: string;
    error?: string;
  };
  // A wait reports late errors in its body, after a 200 status.
  if (!response.ok || result.error)
    throw new Error(`${result.error}: ${result.message}`);
  return result;
}
/** Print the value as JSON. With text, print the text unless the output is for machines. */
async function output(value: unknown, text?: string) {
  const line =
    text === undefined || machine ? JSON.stringify(value, null, 2) : text;
  await new Promise<void>((resolve) =>
    process.stdout.write(line + '\n', () => resolve()),
  );
}
/** Copy a shipped file. Keep a file that the user already has unless `replace` is set. */
function copy(source: URL, destination: string, replace = false) {
  if (!replace && fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, fs.readFileSync(source));
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
  await output(
    result,
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
      for (const file of ['plan.html', 'plan.css'])
        copy(
          new URL(`../examples/${file}`, import.meta.url),
          path.join(destination, file),
        );
      await openTarget(path.join(destination, 'plan.html'));
    },
  },
  wait: {
    flags: [],
    argument: true,
    async run(argument) {
      const route = sessionRoute(argument);
      const r = await service();
      process.stderr.write(
        'Waiting until the user sends feedback or ends the session.\n',
      );
      await output(await request(r, `${route}/wait`, 'POST', {}, 0));
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
  status: {
    flags: [],
    argument: true,
    async run(argument) {
      const r = record();
      const live = await running(r);
      if (live && argument) {
        await output(await request(live, sessionRoute(argument)));
        return;
      }
      await output({
        version,
        runtime: runtimeName,
        runtimeVersion,
        dataDirectory: directory,
        filesPresent: [
          '../ui/index.html',
          '../sdk/sdk.js',
          '../../skills/humagent/SKILL.md',
        ].every((p) => fs.existsSync(new URL(p, import.meta.url))),
        serverRunning: !!live,
        serverVersion: r?.version ?? null,
        ...(live
          ? await request(live, '/api/sessions')
          : {
              note: 'The server is stopped. Use open to resume a saved target.',
            }),
      });
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
      const r = await running();
      await output(
        r
          ? await request(r, '/api/stop', 'POST', {})
          : { stopped: true, alreadyStopped: true },
      );
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
      const skill = new URL('../../skills/humagent/SKILL.md', import.meta.url);
      if (fs.existsSync(file)) {
        if (fs.readFileSync(file, 'utf8') === fs.readFileSync(skill, 'utf8')) {
          await output({ installed: file, unchanged: true });
          return;
        }
        ensure(
          flags.has('force'),
          'The skill contains different text. Preserve your changes or use --force to replace it.',
        );
      }
      copy(skill, file, true);
      await output(
        { installed: file },
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
