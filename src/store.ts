import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { boundedObject, ensure, Failure, input, text, type Input, type Session, type Target } from './protocol.js';

/** Single-process writer; atomic replacement commits before publishing events. */
export class Store extends EventEmitter {
  private data: { protocol: 1; sessions: Record<string, Session> };
  private file: string;
  constructor(public directory: string) {
    super(); fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    this.file = path.join(directory, 'sessions.json');
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      ensure(saved.protocol === 1 && saved.sessions && typeof saved.sessions === 'object', 'Unsupported or corrupt state file');
      this.data = saved;
    } else this.data = {protocol: 1, sessions: {}};
  }
  list() { return Object.values(this.data.sessions); }
  get(id: string): Session { const s = this.data.sessions[id]; if (!s) throw new Failure(404, 'NOT_FOUND', 'Session not found'); return s; }
  private commit(s: Session) {
    const next = {...this.data, sessions: {...this.data.sessions, [s.id]: s}};
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(next)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, this.file); this.data = next;
    } finally { try { fs.unlinkSync(temporary); } catch {} }
    this.emit('change', s.id); return s;
  }
  open(target: Target, revision: string) {
    const existing = this.list().find(s => !s.ended && s.target.value === target.value && s.target.network === target.network);
    if (existing) return this.setRevision(existing.id, revision);
    return this.commit({id: randomUUID(), title: target.kind === 'file' ? path.basename(target.value) : new URL(target.value).pathname,
      target, viewKey: randomBytes(32).toString('hex'), revision, ended: false, createdAt: new Date().toISOString(),
      events: [], replies: [], state: {}, stateVersion: 0, acknowledged: []});
  }
  setRevision(id: string, revision: string) {
    const s = this.get(id); return s.revision === revision ? s : this.commit({...s, revision});
  }
  send(id: string, raw: unknown) {
    const s = this.get(id); ensure(!s.ended, 'Session has ended', 'ENDED', 410);
    const value = input(raw);
    const existing = s.events.find(e => e.clientId === value.clientId);
    if (existing) {
      const original: Input = {protocol: 1, clientId: existing.clientId, kind: existing.kind, revision: existing.revision, payload: existing.payload};
      ensure(JSON.stringify(original) === JSON.stringify(value), 'clientId was reused with different content', 'IDEMPOTENCY_CONFLICT', 409);
      return existing;
    }
    ensure(s.revision === value.revision, 'The interface changed. Refresh, verify the target, and resubmit.', 'STALE_REVISION', 409);
    ensure(s.events.length < 2000, 'Session event limit reached; open a new session', 'SESSION_FULL', 413);
    const event = {...value, id: randomUUID(), createdAt: new Date().toISOString(), status: 'queued' as const, deliveries: 0};
    this.commit({...s, events: [...s.events, event]}); return event;
  }
  saveState(id: string, expectedVersion: unknown, value: unknown) {
    const s = this.get(id); ensure(!s.ended, 'Session has ended', 'ENDED', 410); boundedObject(value);
    ensure(Number.isInteger(expectedVersion) && expectedVersion === s.stateVersion, 'Working state changed in another view. Re-read and reconcile.', 'STATE_CONFLICT', 409);
    return this.commit({...s, state: value, stateVersion: s.stateVersion + 1});
  }
  take(id: string, consumer: string, leaseMs = 120000, now = Date.now()) {
    const s = this.get(id); text(consumer, 'consumer', 100);
    ensure(Number.isInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 3600000, 'Lease must be 1000–3600000 ms');
    if (s.lease && s.lease.expiresAt > now) throw new Failure(409, 'LEASE_ACTIVE', `Batch is leased to ${s.lease.consumer}; acknowledge or wait for expiry`);
    const pending = s.events.filter(e => e.status !== 'completed').slice(0, 100);
    if (!pending.length) return s.ended ? {status: 'ended' as const} : null;
    const lease = {receipt: randomUUID(), consumer, expiresAt: now + leaseMs, eventIds: pending.map(e => e.id)};
    const ids = new Set(lease.eventIds);
    const updated = this.commit({...s, lease, events: s.events.map(e => ids.has(e.id) ? {...e, status: 'delivered', deliveries: e.deliveries + 1} : e)});
    return {status: 'feedback' as const, session: id, target: s.target, receipt: lease.receipt, leaseExpiresAt: lease.expiresAt,
      events: updated.events.filter(e => ids.has(e.id))};
  }
  acknowledge(id: string, receipt: unknown, reply?: string) {
    const s = this.get(id); text(receipt, 'receipt', 100);
    if (reply !== undefined) text(reply, 'reply', 20000);
    if (s.acknowledged.includes(receipt)) {
      const prior = s.replies.find(r => r.receipt === receipt);
      ensure(reply === undefined || prior?.text === reply, 'Receipt already completed with a different reply', 'REPLY_CONFLICT', 409);
      return s;
    }
    ensure(s.lease?.receipt === receipt && s.lease.expiresAt > Date.now(), 'Receipt is unknown or expired; do not acknowledge newer work', 'STALE_RECEIPT', 409);
    const ids = new Set(s.lease.eventIds);
    return this.commit({...s, lease: undefined, acknowledged: [...s.acknowledged, receipt],
      events: s.events.map(e => ids.has(e.id) ? {...e, status: 'completed'} : e),
      replies: reply === undefined ? s.replies : [...s.replies, {id: randomUUID(), text: reply, at: new Date().toISOString(), receipt}]});
  }
  reply(id: string, message: unknown) {
    text(message, 'reply', 20000); const s = this.get(id);
    return this.commit({...s, replies: [...s.replies, {id: randomUUID(), text: message, at: new Date().toISOString()}]});
  }
  renew(id: string, receipt: unknown, leaseMs = 120000) {
    text(receipt, 'receipt', 100); const s = this.get(id); ensure(s.lease && s.lease.receipt === receipt && s.lease.expiresAt > Date.now(), 'Receipt expired or unknown', 'STALE_RECEIPT', 409);
    ensure(Number.isInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 3600000, 'Invalid lease duration');
    return this.commit({...s, lease: {...s.lease, expiresAt: Date.now() + leaseMs}});
  }
  end(id: string) { return this.commit({...this.get(id), ended: true}); }
}
