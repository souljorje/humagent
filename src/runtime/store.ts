import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  ensure,
  Failure,
  item,
  labels,
  localUrl,
  marker,
  object,
  text,
} from './validate.js';
import { writeJson } from './storage.js';
import {
  LIMITS,
  type Draft,
  type DraftItem,
  type Event,
  type SessionView,
  type Target,
} from '../shared/feedback.js';

const FORMAT = 2;

interface Lease {
  receipt: string;
  consumer: string;
  expiresAt: number;
  eventIds: string[];
}
export interface Session {
  id: string;
  title: string;
  target: Target;
  viewKey: string;
  revision: string;
  surfacePath?: string;
  ended: boolean;
  createdAt: string;
  drafts: Draft[];
  message: string;
  events: Event[];
  lease?: Lease;
  acknowledged: string[];
}

const leaseActive = (s: Session, now = Date.now()) =>
  !!s.lease && s.lease.expiresAt > now;

export function sessionView(s: Session, waiting: boolean): SessionView {
  return {
    id: s.id,
    title: s.title,
    target: s.target,
    revision: s.revision,
    ended: s.ended,
    createdAt: s.createdAt,
    agent: leaseActive(s) ? 'working' : waiting ? 'waiting' : 'idle',
    drafts: s.drafts,
    message: s.message,
    sent: s.events
      .filter((event) => event.status !== 'completed')
      .flatMap((event) =>
        event.items
          .filter((entry) => entry.replacement)
          .map((entry) => ({ item: entry, revision: event.revision })),
      ),
  };
}

function readSession(saved: unknown, id: string): Session {
  object(saved);
  const s = saved.session as unknown as Session | undefined;
  const target = s?.target;
  ensure(
    saved.format === FORMAT &&
      s?.id === id &&
      typeof s.title === 'string' &&
      typeof s.revision === 'string' &&
      typeof s.viewKey === 'string' &&
      typeof s.createdAt === 'string' &&
      typeof s.ended === 'boolean' &&
      typeof s.message === 'string' &&
      Array.isArray(s.drafts) &&
      Array.isArray(s.events) &&
      Array.isArray(s.acknowledged) &&
      !!target &&
      typeof target.value === 'string' &&
      typeof target.network === 'boolean' &&
      (target.kind === 'url'
        ? localUrl(new URL(target.value))
        : target.kind === 'file' && typeof target.root === 'string') &&
      (s.surfacePath === undefined ||
        (typeof s.surfacePath === 'string' &&
          s.surfacePath.startsWith('/') &&
          !s.surfacePath.startsWith('//') &&
          !s.surfacePath.includes('\\'))),
    'Unsupported or corrupt session',
  );
  return s;
}
/** Stale input is never rebound to a newer page revision. */
function current(s: Session, revision: unknown) {
  ensure(
    revision === s.revision,
    'The page changed. Refresh it and inspect stale feedback.',
    'STALE_REVISION',
    409,
  );
}

/** Single-process writer. Each change is saved atomically before listeners hear about it. */
export class Store extends EventEmitter {
  private sessions = new Map<string, Session>();
  private failures = new Map<string, string>();
  private directory: string;
  constructor(home: string) {
    super();
    this.directory = path.join(home, 'sessions');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    for (const file of fs.readdirSync(this.directory)) {
      if (!/^[\w-]+\.json$/.test(file)) continue;
      const id = file.slice(0, -5);
      try {
        const source = fs.readFileSync(path.join(this.directory, file), 'utf8');
        this.sessions.set(id, readSession(JSON.parse(source), id));
      } catch {
        this.failures.set(
          id,
          'Stored session is unreadable or unsupported. Restore a compatible backup or use a new data directory.',
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
    writeJson(path.join(this.directory, `${s.id}.json`), {
      format: FORMAT,
      session: s,
    });
    this.sessions.set(s.id, s);
    // Listeners run after the caller finishes, so a listener can commit without re-entering itself.
    queueMicrotask(() => this.emit('change', s.id));
    return s;
  }
  private writable(id: string) {
    const s = this.get(id);
    ensure(!s.ended, 'Session has ended', 'ENDED', 410);
    return s;
  }
  private draft(s: Session, draftId: string) {
    const draft = s.drafts.find((d) => d.item.id === draftId);
    if (!draft) throw new Failure(404, 'NOT_FOUND', 'Feedback not found');
    return draft;
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
      drafts: [],
      message: '',
      events: [],
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
  /** Add a draft. A draft with a known form key replaces that form's draft in place. */
  addDraft(id: string, value: unknown) {
    const s = this.writable(id);
    object(value);
    current(s, value.revision);
    const fields = item(value.item);
    ensure(
      fields.target?.revision === undefined ||
        fields.target.revision === s.revision,
      'Target revision does not match the page',
    );
    if (value.key !== undefined) text(value.key, 'Form key', LIMITS.formKey);
    const key = value.key as string | undefined;
    const previous =
      key === undefined ? undefined : s.drafts.find((d) => d.key === key);
    ensure(
      previous || s.drafts.length < LIMITS.drafts,
      `Send or remove current feedback before adding more than ${LIMITS.drafts} items.`,
      'SESSION_FULL',
      413,
    );
    const position = marker(value.marker);
    const display = labels(value.labels);
    const draft: Draft = {
      item: { id: previous?.item.id ?? randomUUID(), ...fields },
      revision: s.revision,
      ...(position ? { marker: position } : {}),
      ...(key !== undefined ? { key } : {}),
      ...(display ? { labels: display } : {}),
    };
    if (JSON.stringify(previous) !== JSON.stringify(draft))
      this.commit({
        ...s,
        drafts: previous
          ? s.drafts.map((d) => (d === previous ? draft : d))
          : [...s.drafts, draft],
      });
    return draft.item.id;
  }
  /** Edits keep the item ID, target, and original text. */
  editDraft(id: string, draftId: string, value: unknown) {
    const s = this.writable(id);
    object(value);
    current(s, value.revision);
    const draft = this.draft(s, draftId);
    current(s, draft.revision);
    text(value.comment, 'Comment', LIMITS.comment, true);
    const { id: _, comment: _comment, ...previous } = draft.item;
    const changes: DraftItem = {
      ...previous,
      ...(value.comment ? { comment: value.comment } : {}),
    };
    if (value.after !== undefined) {
      ensure(previous.replacement, 'This feedback is not a replacement.');
      text(value.after, 'Replacement', LIMITS.text, true);
      changes.replacement = { ...previous.replacement, after: value.after };
    }
    const position = marker(value.marker);
    const updated: Draft = {
      ...draft,
      item: { id: draftId, ...item(changes) },
      ...(position ? { marker: position } : {}),
    };
    this.commit({
      ...s,
      drafts: s.drafts.map((d) => (d.item.id === draftId ? updated : d)),
    });
  }
  removeDraft(id: string, draftId: string) {
    const s = this.writable(id);
    this.draft(s, draftId);
    this.commit({
      ...s,
      drafts: s.drafts.filter((d) => d.item.id !== draftId),
    });
  }
  setMessage(id: string, value: unknown) {
    const s = this.writable(id);
    text(value, 'Instruction', LIMITS.message, true);
    if (s.message !== value) this.commit({ ...s, message: value });
  }
  /** Turn the current drafts and instruction into one event. */
  send(id: string, revision: unknown) {
    const s = this.writable(id);
    current(s, revision);
    const message = s.message.trim() ? s.message : undefined;
    ensure(
      s.drafts.length || message,
      'Add feedback or an overall instruction',
    );
    ensure(
      s.drafts.every((d) => d.revision === s.revision),
      'Some feedback belongs to another revision. Inspect the page, then recreate or remove stale items.',
      'STALE_REVISION',
      409,
    );
    ensure(
      s.events.length < LIMITS.events,
      'Session event limit reached; open a new session',
      'SESSION_FULL',
      413,
    );
    const event: Event = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      revision: s.revision,
      ...(message ? { message } : {}),
      items: s.drafts.map((d) => d.item),
      status: 'queued',
      deliveries: 0,
    };
    this.commit({
      ...s,
      drafts: [],
      message: '',
      events: [...s.events, event],
    });
    return event;
  }
  take(
    id: string,
    consumer: string,
    leaseMs: number = LIMITS.leaseMs.default,
    now = Date.now(),
  ) {
    const s = this.get(id);
    text(consumer, 'Consumer', LIMITS.consumer);
    leaseDuration(leaseMs);
    if (leaseActive(s, now))
      throw new Failure(
        409,
        'LEASE_ACTIVE',
        `Events are leased to ${s.lease!.consumer}; acknowledge or wait for expiry`,
      );
    const pending = s.events
      .filter((e) => e.status !== 'completed')
      .slice(0, LIMITS.eventsPerReceipt);
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
  acknowledge(id: string, receipt: unknown) {
    const s = this.get(id);
    if (typeof receipt === 'string' && s.acknowledged.includes(receipt))
      return s;
    ensure(
      s.lease?.receipt === receipt && leaseActive(s),
      'Receipt is unknown or expired; do not acknowledge newer work',
      'STALE_RECEIPT',
      409,
    );
    const ids = new Set(s.lease!.eventIds);
    return this.commit({
      ...s,
      lease: undefined,
      acknowledged: [...s.acknowledged, receipt as string],
      events: s.events.map((e) =>
        ids.has(e.id) ? { ...e, status: 'completed' } : e,
      ),
    });
  }
  renew(
    id: string,
    receipt: unknown,
    leaseMs: number = LIMITS.leaseMs.default,
  ) {
    const s = this.get(id);
    ensure(
      s.lease?.receipt === receipt && leaseActive(s),
      'Receipt expired or unknown',
      'STALE_RECEIPT',
      409,
    );
    leaseDuration(leaseMs);
    return this.commit({
      ...s,
      lease: { ...s.lease!, expiresAt: Date.now() + leaseMs },
    });
  }
  end(id: string) {
    return this.commit({ ...this.get(id), ended: true });
  }
}
function leaseDuration(ms: number) {
  ensure(
    Number.isInteger(ms) &&
      ms >= LIMITS.leaseMs.min &&
      ms <= LIMITS.leaseMs.max,
    `Lease must be ${LIMITS.leaseMs.min}–${LIMITS.leaseMs.max} ms`,
  );
}
