import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  binaryName,
  packageName,
  targets,
  WRAPPER_PACKAGE,
  type Target,
} from './targets';

interface PackageOptions {
  root: string;
  directory: string;
  binary: string;
  version: string;
  target: Target;
}

async function command(args: string[], cwd: string) {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0)
    throw new Error(`${args[0]} failed (${code}).\n${stderr}\n${stdout}`);
  return stdout;
}

async function writePackage(root: string, directory: string, metadata: object) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  for (const name of ['README.md', 'LICENSE'])
    await copyFile(path.join(root, name), path.join(directory, name));
  await copyFile(
    path.join(root, 'docs/bun-standalone-experiment.md'),
    path.join(directory, 'EXPERIMENT.md'),
  );
}

async function pack(directory: string, destination: string) {
  // Bun's packer avoids a shell and npm.cmd handling on Windows.
  await command(
    [
      process.execPath,
      'pm',
      'pack',
      '--ignore-scripts',
      '--destination',
      destination,
    ],
    directory,
  );
  const metadata = JSON.parse(
    await readFile(path.join(directory, 'package.json'), 'utf8'),
  ) as { name: string; version: string };
  return path.join(destination, `${metadata.name}-${metadata.version}.tgz`);
}

/** Pack the same executable that acceptance tests run. Installation never downloads or compiles it. */
export async function packageExecutable(options: PackageOptions) {
  const { root, directory, binary, version, target } = options;
  const wrapperDirectory = path.join(directory, 'wrapper');
  const platformDirectory = path.join(directory, 'platform');
  const platformPackageName = packageName(target);
  const common = {
    version,
    private: true,
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/souljorje/humagent.git',
    },
  };
  await writePackage(root, wrapperDirectory, {
    ...common,
    name: WRAPPER_PACKAGE,
    description: 'Unpublished Humagent standalone distribution experiment.',
    bin: { humagent: 'bin/launcher.cjs' },
    engines: { node: '>=24' },
    files: ['bin', 'README.md', 'LICENSE', 'EXPERIMENT.md'],
    optionalDependencies: Object.fromEntries(
      targets.map((item) => [packageName(item), version]),
    ),
  });
  await writePackage(root, platformDirectory, {
    ...common,
    name: platformPackageName,
    description: `Unpublished Humagent executable for ${target.id}.`,
    os: [target.os],
    cpu: [target.cpu],
    ...('libc' in target ? { libc: [target.libc] } : {}),
    files: ['bin', 'README.md', 'LICENSE', 'EXPERIMENT.md'],
  });
  const launcher = path.join(wrapperDirectory, 'bin/launcher.cjs');
  await mkdir(path.dirname(launcher), { recursive: true });
  const result = await Bun.build({
    entrypoints: [path.join(root, 'scripts/standalone/launcher.ts')],
    outdir: path.dirname(launcher),
    naming: 'launcher.cjs',
    target: 'node',
    format: 'cjs',
    packages: 'external',
  });
  if (!result.success)
    throw new AggregateError(result.logs, 'Launcher build failed');
  await chmod(launcher, 0o755);
  const packagedBinary = path.join(
    platformDirectory,
    'bin',
    binaryName(target),
  );
  await mkdir(path.dirname(packagedBinary), { recursive: true });
  await copyFile(binary, packagedBinary);
  await chmod(packagedBinary, 0o755);
  const platformTarball = await pack(platformDirectory, directory);
  const wrapperTarball = await pack(wrapperDirectory, directory);
  return {
    wrapperDirectory,
    platformDirectory,
    wrapperPackageName: WRAPPER_PACKAGE,
    platformPackageName,
    wrapperTarball,
    platformTarball,
  };
}
