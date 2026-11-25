import { spawn } from 'node:child_process';

export function openBrowser(url: string) {
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
