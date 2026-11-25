#!/usr/bin/env node
import { runtimeName, version } from '../server/version.js';
import { errorMessage } from '../shared/errors.js';
import { ensure } from '../shared/validate.js';
import { commands, loop } from './commands.js';
import { HELP } from './help.js';
import { parse } from './options.js';
import { output, outputError } from './output.js';

async function main() {
  const allFlags = [...Object.values(commands), loop].flatMap(
    (command) => command.flags,
  );
  const options = parse(process.argv.slice(2), new Set(allFlags));
  const { flags, positional } = options;
  if (flags.has('version')) {
    if (flags.has('json')) await output({ version });
    else console.log(version);
    return;
  }
  const [name] = positional;
  if (!name || name === 'help' || flags.has('help')) {
    console.log(HELP);
    return;
  }
  // A first argument that is no command is a source for the agent loop.
  const known = Object.hasOwn(commands, name);
  const command = known ? commands[name]! : loop;
  const argument = known ? positional[1] : name;
  ensure(
    positional.length <= (known ? 2 : 1),
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
  await command.run(argument, options);
}
main().catch(async (error) => {
  await outputError(errorMessage(error));
  process.exitCode = 1;
});
