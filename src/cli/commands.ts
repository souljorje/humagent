import fs from 'node:fs';
import path from 'node:path';
import { connect } from '../server/client.js';
import { readRecord } from '../server/record.js';
import { createServer } from '../server/server.js';
import { runtimeName, runtimeVersion, version } from '../server/version.js';
import type { OpenedSession } from '../shared/api.js';
import { ensure } from '../shared/validate.js';
import { openBrowser } from './browser.js';
import type { Options } from './options.js';
import { output } from './output.js';
import { service } from './service.js';

/** Copy a shipped file unless the user already has one. */
function copy(source: URL, destination: string) {
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, fs.readFileSync(source));
}
function sessionId(argument: string | undefined) {
  ensure(
    argument && /^[\w-]+$/.test(argument),
    'Specify a session ID from the open command.',
  );
  return argument;
}
/** Check a source argument. Return a URL as it is and a file as an absolute path. */
function sourceArgument(argument: string | undefined) {
  ensure(
    argument,
    'Specify an HTML file or localhost URL. Example: humagent ./page.html',
  );
  const url = /^https?:/i.test(argument);
  const source = url ? argument : path.resolve(argument);
  ensure(url || fs.existsSync(source), `File not found: ${source}`);
  return source;
}
/** What the human reads after an open. */
const openedText = (opened: OpenedSession, source: string, next = '') =>
  `Open this private URL in your browser:\n${opened.url}\n\nSession: ${opened.session}\nSource: ${source}\n\n${next}${opened.note}`;

async function openSource(source: string, { flags, directory }: Options) {
  const client = await service(directory);
  const opened = await client.open(source, flags.has('network'));
  if (!flags.has('no-open')) openBrowser(opened.url);
  await output(
    opened,
    openedText(
      opened,
      source,
      `Start your agent on it:\n  /humagent ${source}\n\n`,
    ),
  );
}
export interface Command {
  flags: string[];
  /** Whether the command accepts one positional argument. */
  argument: boolean;
  run(argument: string | undefined, options: Options): Promise<void>;
}
/** Every command validates its input before it starts the server. */
export const commands: Record<string, Command> = {
  demo: {
    flags: ['no-open', 'network'],
    argument: false,
    async run(_, options) {
      const destination = path.join(
        options.directory,
        'demos',
        version,
        'plan',
      );
      for (const file of [
        'plan.html',
        'plan.css',
        'plan.js',
        'css-variables.css',
      ])
        copy(
          new URL(`../examples/${file}`, import.meta.url),
          path.join(destination, file),
        );
      await openSource(path.join(destination, 'plan.html'), options);
    },
  },
  status: {
    flags: [],
    argument: true,
    async run(argument, { directory }) {
      const client = await connect(directory);
      if (client && argument) {
        await output(await client.session(sessionId(argument)));
        return;
      }
      await output({
        version,
        runtime: runtimeName,
        runtimeVersion,
        dataDirectory: directory,
        filesPresent: ['../ui/index.html', '../sdk/sdk.js'].every((p) =>
          fs.existsSync(new URL(p, import.meta.url)),
        ),
        serverRunning: !!client,
        serverVersion: readRecord(directory)?.version ?? null,
        ...(client
          ? await client.sessions()
          : {
              note: 'The server is stopped. Use open to resume a saved source.',
            }),
      });
    },
  },
  end: {
    flags: [],
    argument: true,
    async run(argument, { directory }) {
      const id = sessionId(argument);
      await output(await (await service(directory)).end(id));
    },
  },
  stop: {
    flags: [],
    argument: false,
    async run(_, { directory }) {
      const client = await connect(directory);
      await output(
        client ? await client.stop() : { stopped: true, alreadyStopped: true },
      );
    },
  },
  server: {
    flags: ['port'],
    argument: false,
    async run(_, { flags, directory }) {
      const configuredPort = flags.get('port') ?? process.env.HUMAGENT_PORT;
      const port =
        configuredPort === undefined ? undefined : Number(configuredPort);
      ensure(
        port === undefined ||
          (Number.isInteger(port) && port >= 0 && port <= 65535),
        'The server port must be an integer from 0 to 65535.',
      );
      const runtime = await createServer({ directory, port });
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
/**
 * The agent loop in one command: `humagent SOURCE [--done RECEIPT]`.
 * Open or reuse the source's session, complete the given receipt, then wait for feedback.
 */
export const loop: Command = {
  flags: ['no-open', 'no-wait', 'network', 'done'],
  argument: true,
  async run(argument, { flags, directory }) {
    const source = sourceArgument(argument);
    const client = await service(directory);
    const opened = await client.open(source, flags.has('network'));
    // Only the first call opens a browser. Later calls find the workspace open.
    if (!flags.has('no-open') && !opened.viewing) openBrowser(opened.url);
    const receipt = flags.get('done');
    const completed =
      receipt === undefined
        ? undefined
        : await client.complete(opened.session, receipt);
    if (flags.has('no-wait')) {
      await output({ ...completed, ...opened }, openedText(opened, source));
      return;
    }
    process.stderr.write(
      `${opened.viewing ? '' : `Open this private URL in your browser:\n${opened.url}\n`}Waiting until the user sends feedback or ends the session.\n`,
    );
    const result = await client.wait(opened.session);
    await output({ ...result, session: opened.session });
  },
};
