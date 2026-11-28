import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { currentTarget, runtimePackageName, type Target } from './targets';

type PackageMetadata = {
  name: string;
  version: string;
  optionalDependencies?: Record<string, string>;
  dist: { tarball: string; integrity: string };
};

type CompilerRuntime = {
  target: string;
  bunRevision: string;
  bunNpmVersion: string;
  packageName: string;
  packageVersion: string;
  integrity: string;
  sha256: string;
  executablePath: string;
  source: 'host' | 'npm';
};

async function packageMetadata(name: string, version: string) {
  const publishedVersion = version.replace(/\+.*$/, '');
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(publishedVersion)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok)
    throw new Error(`Cannot fetch ${name}@${version}: HTTP ${response.status}`);
  const metadata = (await response.json()) as PackageMetadata;
  if (metadata.name !== name || metadata.version !== publishedVersion)
    throw new Error(`Unexpected package metadata for ${name}@${version}`);
  return metadata;
}

async function checksum(file: string) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

export async function compilerRuntime(
  root: string,
  target: Target,
  bunNpmVersion: string,
): Promise<CompilerRuntime> {
  const directory = path.join(
    root,
    '.local/standalone/compiler',
    bunNpmVersion,
    target.id,
  );
  const cachePath = path.join(directory, 'manifest.json');
  const cache = Bun.file(cachePath);
  const native = currentTarget()?.id === target.id;
  const packageName = runtimePackageName(target);
  const filename = target.os === 'win32' ? 'bun.exe' : 'bun';
  const executablePath = native
    ? process.execPath
    : path.join(directory, filename);

  if (await cache.exists()) {
    const runtime = (await cache.json()) as CompilerRuntime;
    if (
      runtime.target !== target.id ||
      runtime.bunRevision !== Bun.revision ||
      runtime.bunNpmVersion !== bunNpmVersion ||
      runtime.packageName !== packageName ||
      runtime.source !== (native ? 'host' : 'npm') ||
      runtime.sha256 !== (await checksum(executablePath))
    )
      throw new Error(
        `Compiler cache does not match the pinned runtime: ${directory}`,
      );
    return { ...runtime, executablePath };
  }

  const bunPackage = await packageMetadata('bun', bunNpmVersion);
  const packageVersion = bunPackage.optionalDependencies?.[packageName];
  if (!packageVersion)
    throw new Error(`Bun ${bunNpmVersion} has no runtime for ${target.id}`);
  const metadata = await packageMetadata(packageName, packageVersion);
  if (!metadata.dist.integrity.startsWith('sha512-'))
    throw new Error(
      `Missing SHA512 integrity for ${packageName}@${packageVersion}`,
    );

  await mkdir(directory, { recursive: true });
  if (!native) {
    const response = await fetch(metadata.dist.tarball, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`Cannot fetch ${packageName}: HTTP ${response.status}`);
    const tarball = await response.arrayBuffer();
    const integrity = `sha512-${createHash('sha512').update(new Uint8Array(tarball)).digest('base64')}`;
    if (integrity !== metadata.dist.integrity)
      throw new Error(
        `Integrity mismatch for ${packageName}@${packageVersion}`,
      );
    const entry = `package/bin/${filename}`;
    const files = await new Bun.Archive(tarball).files(entry);
    const binary = files.get(entry);
    if (!binary) throw new Error(`Missing ${entry} in ${packageName}`);
    await Bun.write(executablePath, binary);
    await chmod(executablePath, 0o755);
  }

  const runtime: CompilerRuntime = {
    target: target.id,
    bunRevision: Bun.revision,
    bunNpmVersion,
    packageName,
    packageVersion,
    integrity: metadata.dist.integrity,
    sha256: await checksum(executablePath),
    executablePath,
    source: native ? 'host' : 'npm',
  };
  await writeFile(cachePath, `${JSON.stringify(runtime, null, 2)}\n`);
  return runtime;
}
