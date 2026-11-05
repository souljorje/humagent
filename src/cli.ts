#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRuntime } from './server.js';
import { ensure } from './protocol.js';
import { version, runtimeName, runtimeVersion } from './version.js';

const HELP = `Humagent ${version}
Work with your agent through a page, prototype, or local application.

Start here:
  humagent demo                         Open an interactive example
  humagent open ./page.html              Review an HTML file
  humagent open http://localhost:3000    Review a trusted local app
  humagent setup                        Install the agent skill for this project

Agent commands:
  humagent wait <session> [--consumer name] [--timeout seconds] [--lease seconds]
  humagent reply <session> --message "text" [--receipt id]
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
  humagent demo [plan|calculator|existing]
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
const commandFlags: Record<string, string[]> = {
  open: ['no-open', 'network'],
  demo: ['no-open', 'network'],
  wait: ['consumer', 'timeout', 'lease'],
  reply: ['message', 'receipt'],
  ack: ['receipt'],
  renew: ['receipt', 'lease'],
  server: ['port'],
  setup: ['directory', 'force'],
  status: [],
  end: [],
  stop: [],
  doctor: [],
  help: [],
};
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
          Object.values(commandFlags).some((names) => names.includes(key)),
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
  protocol: number;
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
  if (!r || r.protocol !== 1) return false;
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
    `Could not start the server. Read ${path.join(directory, 'server.log')}. Use HUMAGENT_PORT=0 to select a free port.`,
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
function numeric(name: string, fallback: number, maximum: number) {
  const value = Number(flags.get(name) ?? fallback);
  ensure(
    Number.isFinite(value) &&
      value >= (name === 'lease' ? 1 : 0.001) &&
      value <= maximum,
    `--${name} must be between ${name === 'lease' ? 1 : 0.001} and ${maximum} seconds.`,
  );
  return Math.round(value * 1000);
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
async function main() {
  parse();
  if (flags.has('version')) {
    if (flags.has('json')) await output({ version });
    else console.log(version);
    return;
  }
  const [command, argument] = positional;
  if (!command || command === 'help' || flags.has('help')) {
    console.log(HELP);
    return;
  }
  ensure(
    Object.hasOwn(commandFlags, command),
    `Unknown command: ${command}. Run humagent --help.`,
  );
  ensure(
    positional.length <= 2,
    'Too many arguments. Quote file paths that contain spaces.',
  );
  for (const key of flags.keys())
    ensure(
      ['home', 'json'].includes(key) || commandFlags[command]!.includes(key),
      `--${key} is not valid for ${command}.`,
    );
  if (['stop', 'setup', 'doctor', 'server'].includes(command))
    ensure(!argument, `${command} does not accept a positional argument.`);
  if (runtimeName === 'node')
    ensure(
      Number(process.versions.node.split('.')[0]) >= 24,
      'Use Node.js 24 or later, or run this command with Bun 1.4.4 or later.',
    );
  if (command === 'server') {
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
    return;
  }
  if (command === 'setup') {
    const destination = path.resolve(
      flags.get('directory') ?? '.agents/skills/humagent',
    );
    const file = path.join(destination, 'SKILL.md');
    const skill = fs.readFileSync(
      new URL('../skills/humagent/SKILL.md', import.meta.url),
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
    return;
  }
  if (command === 'doctor') {
    const r = record();
    await output({
      version,
      runtime: runtimeName,
      runtimeVersion,
      dataDirectory: directory,
      serverRunning: await alive(r),
      serverVersion: r?.version ?? null,
      filesPresent: [
        '../web/index.html',
        '../web/sdk.js',
        '../skills/humagent/SKILL.md',
      ].every((p) => fs.existsSync(new URL(p, import.meta.url))),
    });
    return;
  }
  if (command === 'stop') {
    const r = record();
    if (!(await alive(r))) {
      await output({ stopped: true, alreadyStopped: true });
      return;
    }
    await output(await request(r!, '/api/stop', 'POST', {}));
    return;
  }
  if (command === 'status' && !(await alive(record()))) {
    await output({
      serverRunning: false,
      note: 'The server is stopped. Use open to resume a saved target.',
    });
    return;
  }
  let target: string | undefined;
  if (command === 'open') {
    ensure(
      argument,
      'Specify an HTML file or localhost URL. Example: humagent open ./page.html',
    );
    target = /^https?:/i.test(argument) ? argument : path.resolve(argument);
    if (!/^https?:/i.test(target))
      ensure(fs.existsSync(target), `File not found: ${target}`);
  }
  if (command === 'demo') {
    const name = argument ?? 'plan';
    ensure(
      ['plan', 'calculator', 'existing'].includes(name),
      'Choose a demo: plan, calculator, or existing.',
    );
    const destination = path.join(directory, 'demos', version);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of [
      'plan.html',
      'calculator.html',
      'existing.html',
      'example.css',
    ]) {
      const to = path.join(destination, file);
      if (!fs.existsSync(to))
        fs.copyFileSync(new URL(`../examples/${file}`, import.meta.url), to);
    }
    target = path.join(destination, `${name}.html`);
  }
  if (!target) {
    if (command !== 'status' || argument)
      ensure(
        argument && /^[\w-]+$/.test(argument),
        'Specify a session ID from the open command.',
      );
    if (command === 'reply')
      ensure(flags.get('message')?.trim(), '--message requires nonempty text.');
    if (command === 'ack' || command === 'renew')
      ensure(flags.get('receipt'), '--receipt is required.');
    if (command === 'wait') numeric('timeout', 50, 600);
    if (command === 'wait' || command === 'renew') numeric('lease', 120, 3600);
  }
  const r = await service();
  if (target) {
    const result = (await request(r, '/api/open', 'POST', {
      target,
      network: flags.has('network'),
    })) as { url: string; session: string; note: string };
    if (!flags.has('no-open')) openBrowser(result.url);
    if (machine) await output(result);
    else
      console.log(
        `Open this private URL in your browser:\n${result.url}\n\nSession: ${result.session}\nSource: ${target}\n\nAsk your agent to run:\n  humagent wait ${result.session}\n\n${result.note}\nNo agent is connected until it starts waiting.`,
      );
    return;
  }
  if (command === 'status') {
    await output(
      await request(
        r,
        argument ? `/api/sessions/${argument}` : '/api/sessions',
      ),
    );
    return;
  }
  const base = `/api/sessions/${argument}`;
  if (command === 'wait') {
    const timeoutMs = numeric('timeout', 50, 600);
    process.stderr.write(
      'Waiting for input. Keep this command attached to the active agent turn.\n',
    );
    await output(
      await request(
        r,
        `${base}/wait`,
        'POST',
        {
          consumer: flags.get('consumer') ?? 'agent',
          timeoutMs,
          leaseMs: numeric('lease', 120, 3600),
        },
        timeoutMs + 5000,
      ),
    );
    return;
  }
  if (command === 'reply') {
    await output(
      await request(r, `${base}/reply`, 'POST', {
        message: flags.get('message'),
        receipt: flags.get('receipt'),
      }),
    );
    return;
  }
  if (command === 'ack' || command === 'renew') {
    await output(
      await request(r, `${base}/${command}`, 'POST', {
        receipt: flags.get('receipt'),
        leaseMs: numeric('lease', 120, 3600),
      }),
    );
    return;
  }
  if (command === 'end') {
    await output(await request(r, `${base}/end`, 'POST', {}));
    return;
  }
}
main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (machine) await output({ error: message });
  else process.stderr.write(`Humagent: ${message}\n`);
  process.exitCode = 1;
});
