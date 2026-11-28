#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:os';
import { binaryName, currentTarget, packageName } from './targets';

const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

function signalStatus(signal: NodeJS.Signals) {
  return 128 + (constants.signals[signal] ?? 1);
}

function forward(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

function launch() {
  const target = currentTarget();
  if (!target)
    throw new Error(
      `Unsupported platform: ${process.platform}/${process.arch}. This experiment supports macOS, Linux, and Windows on x64 or ARM64.`,
    );
  const name = packageName(target);
  let executable: string;
  try {
    // This dynamic require remains in the generated CommonJS launcher.
    executable = require.resolve(`${name}/bin/${binaryName(target)}`);
  } catch {
    throw new Error(
      `Missing executable package ${name}. Install the matching experiment package. Do not omit optional dependencies.`,
    );
  }
  const child = spawn(executable, process.argv.slice(2), { stdio: 'inherit' });
  const handlers = signals.map((signal) => ({
    signal,
    handler: () => forward(child, signal),
  }));
  for (const { signal, handler } of handlers) process.on(signal, handler);
  child.once('error', (error) => {
    console.error(`Could not start Humagent: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('close', (code, signal) => {
    for (const item of handlers) process.off(item.signal, item.handler);
    if (!signal) {
      process.exitCode = code ?? 1;
      return;
    }
    process.exitCode = signalStatus(signal);
    if (process.platform !== 'win32') process.kill(process.pid, signal);
  });
}

try {
  launch();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
