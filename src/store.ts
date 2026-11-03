import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  boundedObject,
  ensure,
  Failure,
  input,
  text,
  type Input,
  type Session,
  type Target,
} from './protocol.js';
import { writeJson } from './storage.js';

function readSession(
  saved: { protocol?: unknown; session?: Session },
  id: string,
) {
  const session = saved.session;
  const target = session?.target;
  ensure(
    saved.protocol === 1 &&
      session?.id === id &&
      typeof session.title === 'string' &&
      typeof session.revision === 'string' &&
      typeof session.viewKey === 'string' &&
      typeof session.createdAt === 'string' &&
      typeof session.ended === 'boolean' &&
      Number.isInteger(session.stateVersion) &&
      session.stateVersion >= 0 &&
      Array.isArray(session.events) &&
      Array.isArray(session.replies) &&
      Array.isArray(session.acknowledged) &&
      target &&
      typeof target.value === 'string' &&
      typeof target.network === 'boolean' &&
      (target.kind === 'url' ||
        (target.kind === 'file' && typeof target.root === 'string')),
    'Unsupported or corrupt session',
  );
  if (target.kind === 'url') {
    const url = new URL(target.value);
    ensure(
      url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname) &&
        !url.username &&
        !url.password,
      'Unsupported stored target',
    );
  }
  if (session.surfacePath !== undefined) {
    ensure(
      typeof session.surfacePath === 'string' &&
        session.surfacePath.startsWith('/') &&
        !session.surfacePath.startsWith('//') &&
        !session.surfacePath.includes('\\'),
      'Invalid stored page path',
    );
  }
  boundedObject(session.state);
  return session;
}

/** Single-process writer; atomic replacement commits before publishing events. */
export class Store extends EventEmitter {
  private sessions = new Map<string, Session>();
  private failures = new Map<string, string>();
  private sessionDirectory: string;
  constructor(public directory: string) {
    super();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.sessionDirectory = path.join(directory, 'sessions');
    fs.mkdirSync(this.sessionDirectory, { recursive: true, mode: 0o700 });
    const legacy = path.join(directory, 'sessions.json');
    if (fs.existsSync(legacy)) {
      const saved = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      ensure(
        saved.protocol === 1 &&
          saved.sessions &&
          typeof saved.sessions === 'object',
        'Unsupported or corrupt state file',
      );
      for (const [id, session] of Object.entries(saved.sessions)) {
        ensure(
          /^[\w-]+$/.test(id) && (session as Session)?.id === id,
          'Unsupported or corrupt session',
        );
        const file = path.join(this.sessionDirectory, `${id}.json`);
        if (!fs.existsSync(file)) writeJson(file, { protocol: 1, session });
      }
      const backup = path.join(directory, 'sessions.legacy.json');
      fs.renameSync(
        legacy,
        fs.existsSync(backup) ? `${backup}.${randomUUID()}` : backup,
      );
    }
    for (const file of fs.readdirSync(this.sessionDirectory)) {
      if (!/^[\w-]+\.json$/.test(file)) continue;
      const id = file.slice(0, -5);
      try {
        const saved = JSON.parse(
          fs.readFileSync(path.join(this.sessionDirectory, file), 'utf8'),
        );
        const session = readSession(saved, id);
        this.sessions.set(id, session);
      } catch {
        this.failures.set(
          id,
          'Stored session is unreadable. Restore its file from a backup.',
        );
      }
    }
  }
  list() {
    return [...this.sessions.values()];
  }
  errors() {
    return [...this.failures].map(([id, message]) => ({ id, message }));
  }
  get(id: string): Session {
    const failure = this.failures.get(id);
    if (failure) throw new Failure(500, 'CORRUPT_SESSION', failure);
    const session = this.sessions.get(id);
    if (!session) throw new Failure(404, 'NOT_FOUND', 'Session not found');
    return session;
  }
  private commit(s: Session) {
    writeJson(path.join(this.sessionDirectory, `${s.id}.json`), {
      protocol: 1,
      session: s,
    });
    this.sessions.set(s.id, s);
    this.emit('change', s.id);
    return s;
  }
  open(target: Target, revision: string) {
    const existing = this.list().find(
      (s) =>
        !s.ended &&
        s.target.value === target.value &&
        s.target.network === target.network,
    );
    if (existing) return existing;
    return this.commit({
      id: randomUUID(),
      title:
        target.kind === 'file'
          ? path.basename(target.value)
          : new URL(target.value).pathname,
      target,
      viewKey: randomBytes(32).toString('hex'),
      revision,
      ended: false,
      createdAt: new Date().toISOString(),
      events: [],
      replies: [],
      state: {},
      stateVersion: 0,
      acknowledged: [],
    });
  }
  setRevision(
    id: string,
    revision: string,
    surfacePath = this.get(id).surfacePath,
  ) {
    const s = this.get(id);
    return s.revision === revision && s.surfacePath === surfacePath
      ? s
      : this.commit({ ...s, revision, surfacePath });
  }
  send(id: string, raw: unknown) {
    const s = this.get(id);
    ensure(!s.ended, 'Session has ended', 'ENDED', 410);
    const value = input(raw);
    const existing = s.events.find((e) => e.clientId === value.clientId);
    if (existing) {
      const original: Input = {
        protocol: 1,
        clientId: existing.clientId,
        kind: existing.kind,
        revision: existing.revision,
        payload: existing.payload,
      };
      ensure(
        JSON.stringify(original) === JSON.stringify(value),
        'clientId was reused with different content',
        'IDEMPOTENCY_CONFLICT',
        409,
      );
      return existing;
    }
    ensure(
      s.revision === value.revision,
      'The interface changed. Refresh, verify the target, and resubmit.',
      'STALE_REVISION',
      409,
    );
    ensure(
      s.events.length < 2000,
      'Session event limit reached; open a new session',
      'SESSION_FULL',
      413,
    );
    const event = {
      ...value,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'queued' as const,
      deliveries: 0,
    };
    this.commit({ ...s, events: [...s.events, event] });
    return event;
  }
  saveState(id: string, expectedVersion: unknown, value: unknown) {
    const s = this.get(id);
    ensure(!s.ended, 'Session has ended', 'ENDED', 410);
    boundedObject(value);
    ensure(
      Number.isInteger(expectedVersion) && expectedVersion === s.stateVersion,
      'Working state changed in another view. Re-read and reconcile.',
      'STATE_CONFLICT',
      409,
    );
    return this.commit({
      ...s,
      state: value,
      stateVersion: s.stateVersion + 1,
    });
  }
  take(id: string, consumer: string, leaseMs = 120000, now = Date.now()) {
    const s = this.get(id);
    text(consumer, 'consumer', 100);
    ensure(
      Number.isInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 3600000,
      'Lease must be 1000–3600000 ms',
    );
    if (s.lease && s.lease.expiresAt > now)
      throw new Failure(
        409,
        'LEASE_ACTIVE',
        `Batch is leased to ${s.lease.consumer}; acknowledge or wait for expiry`,
      );
    const pending = s.events
      .filter((e) => e.status !== 'completed')
      .slice(0, 100);
    if (!pending.length) return s.ended ? { status: 'ended' as const } : null;
    const lease = {
      receipt: randomUUID(),
      consumer,
      expiresAt: now + leaseMs,
      eventIds: pending.map((e) => e.id),
    };
    const ids = new Set(lease.eventIds);
    const updated = this.commit({
      ...s,
      lease,
      events: s.events.map((e) =>
        ids.has(e.id)
          ? { ...e, status: 'delivered', deliveries: e.deliveries + 1 }
          : e,
      ),
    });
    return {
      status: 'feedback' as const,
      session: id,
      target: s.target,
      receipt: lease.receipt,
      leaseExpiresAt: lease.expiresAt,
      events: updated.events.filter((e) => ids.has(e.id)),
    };
  }
  acknowledge(id: string, receipt: unknown, reply?: string) {
    const s = this.get(id);
    text(receipt, 'receipt', 100);
    if (reply !== undefined) text(reply, 'reply', 20000);
    if (s.acknowledged.includes(receipt)) {
      const prior = s.replies.find((r) => r.receipt === receipt);
      ensure(
        reply === undefined || prior?.text === reply,
        'Receipt already completed with a different reply',
        'REPLY_CONFLICT',
        409,
      );
      return s;
    }
    ensure(
      s.lease?.receipt === receipt && s.lease.expiresAt > Date.now(),
      'Receipt is unknown or expired; do not acknowledge newer work',
      'STALE_RECEIPT',
      409,
    );
    const ids = new Set(s.lease.eventIds);
    return this.commit({
      ...s,
      lease: undefined,
      acknowledged: [...s.acknowledged, receipt],
      events: s.events.map((e) =>
        ids.has(e.id) ? { ...e, status: 'completed' } : e,
      ),
      replies:
        reply === undefined
          ? s.replies
          : [
              ...s.replies,
              {
                id: randomUUID(),
                text: reply,
                at: new Date().toISOString(),
                receipt,
              },
            ],
    });
  }
  reply(id: string, message: unknown) {
    text(message, 'reply', 20000);
    const s = this.get(id);
    return this.commit({
      ...s,
      replies: [
        ...s.replies,
        { id: randomUUID(), text: message, at: new Date().toISOString() },
      ],
    });
  }
  renew(id: string, receipt: unknown, leaseMs = 120000) {
    text(receipt, 'receipt', 100);
    const s = this.get(id);
    ensure(
      s.lease && s.lease.receipt === receipt && s.lease.expiresAt > Date.now(),
      'Receipt expired or unknown',
      'STALE_RECEIPT',
      409,
    );
    ensure(
      Number.isInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 3600000,
      'Invalid lease duration',
    );
    return this.commit({
      ...s,
      lease: { ...s.lease, expiresAt: Date.now() + leaseMs },
    });
  }
  end(id: string) {
    return this.commit({ ...this.get(id), ended: true });
  }
}
