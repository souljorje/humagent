export const WRAPPER_PACKAGE = 'humagent-bun-experiment';

/** The compiler can build these targets. Native smoke tests establish runtime support separately. */
export const targets = [
  { id: 'bun-darwin-arm64', os: 'darwin', cpu: 'arm64' },
  { id: 'bun-darwin-x64', os: 'darwin', cpu: 'x64' },
  { id: 'bun-linux-arm64', os: 'linux', cpu: 'arm64', libc: 'glibc' },
  { id: 'bun-linux-x64', os: 'linux', cpu: 'x64', libc: 'glibc' },
  { id: 'bun-linux-arm64-musl', os: 'linux', cpu: 'arm64', libc: 'musl' },
  { id: 'bun-linux-x64-musl', os: 'linux', cpu: 'x64', libc: 'musl' },
  { id: 'bun-windows-arm64', os: 'win32', cpu: 'arm64' },
  { id: 'bun-windows-x64', os: 'win32', cpu: 'x64' },
] as const;

export type Target = (typeof targets)[number];

export function packageName(target: Target) {
  const libc = 'libc' in target ? `-${target.libc}` : '';
  return `${WRAPPER_PACKAGE}-${target.os}-${target.cpu}${libc}`;
}

/** The Node-compatible report exposes glibc on Linux. No glibc field means musl. */
export function currentTarget() {
  const report = process.report.getReport() as {
    header: { glibcVersionRuntime?: string };
  };
  const libc = report.header.glibcVersionRuntime ? 'glibc' : 'musl';
  return targets.find(
    (target) =>
      target.os === process.platform &&
      target.cpu === process.arch &&
      (!('libc' in target) || target.libc === libc),
  );
}

export const binaryName = (target: Target) =>
  target.os === 'win32' ? 'humagent.exe' : 'humagent';
