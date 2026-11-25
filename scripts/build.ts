/** Build the package into `dist/`: compiled modules, static files, and the generated CSS variables. */
import { $, Glob } from 'bun';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dir, '..');
const source = path.join(root, 'src');
const output = path.join(root, 'dist');

fs.rmSync(output, { recursive: true, force: true });
// The compiler prints its own errors.
const { exitCode } = await $`tsc`.cwd(root).nothrow();
if (exitCode) process.exit(exitCode);

const files = new Glob('{ui,examples}/**/*.{html,css}');
for await (const file of files.scan(source))
  fs.cpSync(path.join(source, file), path.join(output, file));

const { cssVariables } = (await import(
  path.join(output, 'shared/css-variables.js')
)) as { cssVariables: string };
for (const directory of ['ui', 'examples'])
  await Bun.write(
    path.join(output, directory, 'css-variables.css'),
    `:root {${cssVariables}}\n`,
  );
