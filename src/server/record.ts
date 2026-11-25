/** The record of the server that owns a state directory. The client finds the server through it. */
import fs from 'node:fs';
import path from 'node:path';
import { ensure } from '../shared/validate.js';
import { writeJson } from './storage.js';

export interface ServerRecord {
  pid: number;
  origin: string;
  token: string;
  version?: string;
}
const recordFile = (directory: string) => path.join(directory, 'server.json');

export function readRecord(directory: string): ServerRecord | null {
  try {
    return JSON.parse(fs.readFileSync(recordFile(directory), 'utf8'));
  } catch {
    return null;
  }
}
/** Claim a state directory for this process. A live owner refuses the claim. */
export function claimDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // The record claims the directory before the store opens. It gains origin and token after listen.
  const record = recordFile(directory);
  // `wx` fails when the record exists, so two servers cannot claim one directory.
  const claim = () => {
    const fd = fs.openSync(record, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    fs.closeSync(fd);
  };
  try {
    claim();
  } catch {
    let alive = true;
    let pid = 0;
    try {
      pid = Number(JSON.parse(fs.readFileSync(record, 'utf8')).pid);
    } catch {}
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (e) {
        alive = (e as NodeJS.ErrnoException).code !== 'ESRCH';
      }
    }
    ensure(
      !alive,
      'Another server owns this state directory',
      'SERVER_ACTIVE',
      409,
    );
    fs.unlinkSync(record);
    claim();
  }
  return {
    publish: (server: Omit<ServerRecord, 'pid'>) =>
      writeJson(record, { pid: process.pid, ...server }),
    release: () => fs.rmSync(record, { force: true }),
  };
}
