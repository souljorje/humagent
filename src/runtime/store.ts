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

/** The events that the last `wait` returned. They stay unfinished until the agent acknowledges this receipt. */
interface Delivery {
  receipt: string;
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
  delivery?: Delivery;
  acknowledged: string[];
}

export function sessionView(s: Session, waiting: boolean): SessionView {
  return {
    id: s.id,
    title: s.title,
    target: s.target,
    revision: s.revision,
    ended: s.ended,
    createdAt: s.createdAt,
    agent: s.delivery ? 'working' : waiting ? 'waiting' : 'idle',
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
  /** The interruption of each waiting agent. At most one agent waits per session. */
  private waiting = new Map<string, () => void>();
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
    const key =
      value.key === undefined
        ? undefined
        : text(value.key, 'Form key', LIMITS.formKey);
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
    const comment = text(value.comment, 'Comment', LIMITS.comment, true);
    const { id: _, comment: _comment, ...previous } = draft.item;
    const changes: DraftItem = { ...previous, ...(comment ? { comment } : {}) };
    if (value.after !== undefined) {
      ensure(previous.replacement, 'This feedback is not a replacement.');
      changes.replacement = {
        ...previous.replacement,
        after: text(value.after, 'Replacement', LIMITS.text, true),
      };
    }
    const updated: Draft = {
      ...draft,
      item: { id: draftId, ...item(changes) },
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
    const message = text(value, 'Instruction', LIMITS.message, true);
    if (s.message !== message) this.commit({ ...s, message });
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
  /** Deliver every unfinished event. Unacknowledged events come back with the next delivery. */
  take(id: string) {
    const s = this.get(id);
    const pending = s.events
      .filter((e) => e.status !== 'completed')
      .slice(0, LIMITS.eventsPerReceipt);
    if (!pending.length) return s.ended ? { status: 'ended' as const } : null;
    const delivery = {
      receipt: randomUUID(),
      eventIds: pending.map((e) => e.id),
    };
    const ids = new Set(delivery.eventIds);
    const updated = this.commit({
      ...s,
      delivery,
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
      receipt: delivery.receipt,
      events: updated.events.filter((e) => ids.has(e.id)),
    };
  }
  acknowledge(id: string, receipt: unknown) {
    const s = this.get(id);
    if (typeof receipt === 'string' && s.acknowledged.includes(receipt))
      return s;
    ensure(
      typeof receipt === 'string' && s.delivery?.receipt === receipt,
      'Receipt is unknown or replaced by a newer wait; do not acknowledge newer work',
      'STALE_RECEIPT',
      409,
    );
    const ids = new Set(s.delivery!.eventIds);
    return this.commit({
      ...s,
      delivery: undefined,
      acknowledged: [...s.acknowledged, receipt as string],
      events: s.events.map((e) =>
        ids.has(e.id) ? { ...e, status: 'completed' } : e,
      ),
    });
  }
  end(id: string) {
    return this.commit({ ...this.get(id), ended: true });
  }
  isWaiting(id: string) {
    return this.waiting.has(id);
  }
  /**
   * Resolve with the first delivery from `take`, after each session change.
   * Resolve with an interruption when the signal aborts or the server stops.
   * Ownership and session errors throw before the wait starts. Later errors reject.
   */
  wait(
    id: string,
    signal: AbortSignal,
  ): Promise<
    NonNullable<ReturnType<Store['take']>> | { status: 'interrupted' }
  > {
    ensure(
      !this.waiting.has(id),
      'Another agent is already waiting',
      'LISTENER_ACTIVE',
      409,
    );
    if (signal.aborted) return Promise.resolve({ status: 'interrupted' });
    const immediate = this.take(id);
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (settle: () => void) => {
        if (done) return;
        done = true;
        this.off('change', changed);
        signal.removeEventListener('abort', cancel);
        this.waiting.delete(id);
        settle();
      };
      const cancel = () => finish(() => resolve({ status: 'interrupted' }));
      const changed = (session: string) => {
        if (session !== id || done) return;
        try {
          const next = this.take(id);
          if (next) finish(() => resolve(next));
        } catch (error) {
          finish(() => reject(error));
        }
      };
      this.on('change', changed);
      this.waiting.set(id, cancel);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  /** Interrupt every waiting agent. */
  interruptWaits() {
    for (const cancel of this.waiting.values()) cancel();
  }
}
