import path from 'node:path';
import os from 'node:os';
import { ensure } from '../shared/validate.js';

const booleanFlags = new Set([
  'no-open',
  'no-wait',
  'network',
  'help',
  'version',
  'json',
]);
export interface Options {
  flags: ReadonlyMap<string, string>;
  positional: readonly string[];
  /** The private data directory. */
  directory: string;
}
/** Parse the command line. `known` holds the flags of all commands. */
export function parse(
  args: readonly string[],
  known: ReadonlySet<string>,
): Options {
  const flags = new Map<string, string>();
  const positional: string[] = [];
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
      ensure(key === 'home' || known.has(key), `Unknown option: --${key}.`);
      const value = inline.length ? inline.join('=') : args[++i];
      ensure(
        value !== undefined && !value.startsWith('--'),
        `Provide a value for --${key}.`,
      );
      flags.set(key, value);
    }
  }
  const directory = path.resolve(
    flags.get('home') ??
      process.env.HUMAGENT_HOME ??
      path.join(os.homedir(), '.humagent'),
  );
  return { flags, positional, directory };
}
