import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageExecutable } from './package';
import { binaryName, currentTarget, targets } from './targets';

const root = fileURLToPath(new URL('../../', import.meta.url));
const expectedBun = '1.4.5';

function selectedTarget() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    const target = currentTarget();
    if (target) return target;
    throw new Error(
      `Unsupported build host: ${process.platform}/${process.arch}`,
    );
  }
  const name =
    args.length === 2 && args[0] === '--target'
      ? args[1]
      : args.length === 1 && args[0]?.startsWith('--target=')
        ? args[0].slice('--target='.length)
        : undefined;
  const target = targets.find((item) => item.id === name);
  if (!target)
    throw new Error(
      `Use --target with one of: ${targets.map((item) => item.id).join(', ')}`,
    );
  return target;
}

async function checksum(file: string) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

async function build() {
  if (Bun.version !== expectedBun)
    throw new Error(
      `This experiment requires Bun ${expectedBun}. Found ${Bun.version}.`,
    );
  const target = selectedTarget();
  const metadata = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  ) as {
    version: string;
  };
  const version = `${metadata.version}-bun-experiment.0`;
  const output = path.join(root, '.local/standalone');
  const directory = path.join(output, target.id);
  const binary = path.join(directory, binaryName(target));
  const assets = ['client', 'examples'].map((name) =>
    path.join(root, 'dist', name),
  );
  for (const asset of assets) {
    if (!(await stat(asset)).isDirectory())
      throw new Error(`Missing built assets: ${asset}`);
  }
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const result = await Bun.build({
    entrypoints: [path.join(root, 'src/cli/index.ts')],
    target: 'bun',
    minify: true,
    sourcemap: 'linked',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      __HUMAGENT_STANDALONE_VERSION__: JSON.stringify(version),
    },
    compile: {
      target: target.id,
      outfile: binary,
      assets,
      autoloadTsconfig: false,
      autoloadPackageJson: false,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });
  if (!result.success)
    throw new AggregateError(result.logs, 'Executable build failed');
  const packages = await packageExecutable({
    root,
    directory,
    binary,
    version,
    target,
  });
  const files = [binary, packages.wrapperTarball, packages.platformTarball];
  const hashes = await Promise.all(files.map(checksum));
  const manifest = {
    schemaVersion: 1,
    bunVersion: Bun.version,
    applicationVersion: version,
    sourceVersion: metadata.version,
    version,
    target: target.id,
    native: currentTarget()?.id === target.id,
    binary,
    ...packages,
    sha256: hashes[0],
    sizeBytes: (await stat(binary)).size,
    targets: targets.map((item) => item.id),
  };
  await writeFile(
    path.join(directory, 'checksums.sha256'),
    files
      .map((file, index) => `${hashes[index]}  ${path.basename(file)}\n`)
      .join(''),
  );
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(directory, 'manifest.json'), json);
  await writeFile(path.join(output, 'manifest.json'), json);
  console.log(json);
}

await build();
