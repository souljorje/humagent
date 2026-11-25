/** The record of the server that owns a state directory. The client finds the server through it. */
import fs from 'node:fs';
import path from 'node:path';
import { ensure } from '@/shared/validate';
import { writeJson } from './storage';

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
/** What a server holds while it owns a state directory. */
export interface Claim {
  publish(server: Omit<ServerRecord, 'pid'>): void;
  release(): void;
}

/** `wx` fails when the record exists, so two servers cannot claim one directory. */
function createRecord(record: string) {
  const fd = fs.openSync(record, 'wx', 0o600);
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
  fs.closeSync(fd);
}
/** A record without a readable process has an owner. */
function hasOwner(directory: string) {
  const pid = Number(readRecord(directory)?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
/**
 * Claim a state directory for this process. A live owner refuses the claim.
 * The record claims the directory before the store opens. It gains origin and token after listen.
 */
export function claimDirectory(directory: string): Claim {
  const record = recordFile(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    createRecord(record);
  } catch {
    ensure(
      !hasOwner(directory),
      'Another server owns this state directory',
      'SERVER_ACTIVE',
      409,
    );
    fs.unlinkSync(record);
    createRecord(record);
  }
  return {
    publish: (server) => writeJson(record, { pid: process.pid, ...server }),
    release: () => fs.rmSync(record, { force: true }),
  };
}
