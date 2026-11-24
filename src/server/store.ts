import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { ensure, Failure, review, localUrl, object, text } from './validate.js';
import { writeJson } from './storage.js';
import {
  LIMITS,
  type SavedReview,
  type Delivered,
  type Feedback,
  type SessionView,
  type Source,
} from '../shared/feedback.js';
import type { Json } from '../shared/json.js';

const FORMAT = 4;

/** The feedback that the last `wait` returned. They stay unfinished until the agent completes this receipt. */
interface Delivery {
  receipt: string;
  feedbackIds: string[];
  started?: boolean;
}
export interface Session {
  id: string;
  title: string;
  source: Source;
  sessionKey: string;
  revision: string;
  pagePath?: string;
  ended: boolean;
  createdAt: string;
  pending: SavedReview[];
  instruction: string;
  feedback: Feedback[];
  delivery?: Delivery;
  completed: string[];
}

function readSession(saved: unknown, id: string): Session {
  object(saved);
  const s = saved.session as unknown as Session | undefined;
  const source = s?.source;
  ensure(
    saved.format === FORMAT &&
      s?.id === id &&
      typeof s.title === 'string' &&
      typeof s.revision === 'string' &&
      typeof s.sessionKey === 'string' &&
      typeof s.createdAt === 'string' &&
      typeof s.ended === 'boolean' &&
      typeof s.instruction === 'string' &&
      Array.isArray(s.pending) &&
      Array.isArray(s.feedback) &&
      Array.isArray(s.completed) &&
      !!source &&
      typeof source.value === 'string' &&
      typeof source.network === 'boolean' &&
      (source.kind === 'url'
        ? localUrl(new URL(source.value))
        : source.kind === 'file' && typeof source.root === 'string') &&
      (s.pagePath === undefined ||
        (typeof s.pagePath === 'string' &&
          s.pagePath.startsWith('/') &&
          !s.pagePath.startsWith('//') &&
          !s.pagePath.includes('\\'))),
    'Unsupported or corrupt session',
  );
  // A previous process cannot confirm that the agent is still working.
  if (s.delivery) s.delivery.started = false;
  return s;
}
/** Stale input is never rebound to a newer page revision. */
function current(s: Session, revision: unknown) {
  ensure(
    revision === s.revision,
    'The page changed. Refresh it and inspect stale reviews.',
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
  view(id: string): SessionView {
    const s = this.get(id);
    return {
      id: s.id,
      title: s.title,
      source: s.source,
      revision: s.revision,
      ended: s.ended,
      createdAt: s.createdAt,
      agent: s.delivery?.started
        ? 'working'
        : s.feedback.some((feedback) => feedback.status !== 'completed')
          ? 'sent'
          : this.waiting.has(id)
            ? 'connected'
            : 'idle',
      pending: s.pending,
      instruction: s.instruction,
      sent: s.feedback
        .filter((feedback) => feedback.status !== 'completed')
        .flatMap((feedback) =>
          feedback.reviews.map((saved) => ({
            review: saved,
            revision: feedback.revision,
          })),
        ),
    };
  }
  private saved(s: Session, reviewId: string) {
    const saved = s.pending.find((d) => d.review.id === reviewId);
    if (!saved) throw new Failure(404, 'NOT_FOUND', 'Review not found');
    return saved;
  }
  open(source: Source, revision: string) {
    const existing = this.list().find(
      (s) =>
        !s.ended &&
        s.source.value === source.value &&
        s.source.network === source.network,
    );
    if (existing) return existing;
    let id: string;
    do {
      id = randomBytes(6).toString('hex');
    } while (this.sessions.has(id) || this.failures.has(id));
    return this.commit({
      id,
      title:
        source.kind === 'file'
          ? path.basename(source.value)
          : new URL(source.value).pathname,
      source,
      sessionKey: randomBytes(32).toString('hex'),
      revision,
      ended: false,
      createdAt: new Date().toISOString(),
      pending: [],
      instruction: '',
      feedback: [],
      completed: [],
    });
  }
  setRevision(id: string, revision: string, pagePath = this.get(id).pagePath) {
    const s = this.get(id);
    return s.revision === revision && s.pagePath === pagePath
      ? s
      : this.commit({ ...s, revision, pagePath });
  }
  /**
   * Add a pending review. A pending review with a known kind and key replaces that pending review.
   * The replacement keeps the review ID and the list position. It replaces every other field.
   */
  addReview(id: string, value: unknown) {
    const s = this.writable(id);
    object(value);
    current(s, value.revision);
    object(value.review, 'Review');
    const { kind } = value.review;
    const key =
      value.key === undefined
        ? undefined
        : text(value.key, 'Review key', LIMITS.key);
    const previous =
      key === undefined
        ? undefined
        : s.pending.find((d) => d.key === key && d.review.kind === kind);
    ensure(
      previous || s.pending.length < LIMITS.pending,
      `Send or remove pending reviews before adding more than ${LIMITS.pending}.`,
      'SESSION_FULL',
      413,
    );
    const saved: SavedReview = {
      review: review(value.review, previous?.review.id ?? randomUUID()),
      revision: s.revision,
      ...(key !== undefined ? { key } : {}),
      ...(value.local !== undefined ? { local: value.local as Json } : {}),
    };
    if (JSON.stringify(previous) !== JSON.stringify(saved))
      this.commit({
        ...s,
        pending: previous
          ? s.pending.map((d) => (d === previous ? saved : d))
          : [...s.pending, saved],
      });
    return saved.review.id;
  }
  /**
   * Edit a pending review. The edit keeps the review ID, kind, key, target, private data, and list position.
   * It replaces the comment, and the data when the edit gives data.
   */
  editReview(id: string, reviewId: string, value: unknown) {
    const s = this.writable(id);
    object(value);
    current(s, value.revision);
    const saved = this.saved(s, reviewId);
    current(s, saved.revision);
    const { id: _, ...previous } = saved.review;
    const changes = {
      ...previous,
      comment: text(value.comment, 'Comment', LIMITS.comment, true),
      ...(value.data !== undefined ? { data: value.data } : {}),
    };
    const updated: SavedReview = {
      ...saved,
      review: review(changes, reviewId),
    };
    this.commit({
      ...s,
      pending: s.pending.map((d) => (d.review.id === reviewId ? updated : d)),
    });
  }
  removeReview(id: string, reviewId: string, revision?: string) {
    const s = this.writable(id);
    const saved = this.saved(s, reviewId);
    ensure(
      revision === undefined || revision === saved.revision,
      'The review changed revision. Inspect it before deleting it.',
      'STALE_REVISION',
      409,
    );
    this.commit({
      ...s,
      pending: s.pending.filter((d) => d.review.id !== reviewId),
    });
  }
  setInstruction(id: string, value: unknown) {
    const s = this.writable(id);
    const instruction = text(value, 'Instruction', LIMITS.instruction, true);
    if (s.instruction !== instruction) this.commit({ ...s, instruction });
  }
  /** One Send: the instruction and the pending reviews become one feedback. */
  send(id: string, revision: unknown) {
    const s = this.writable(id);
    current(s, revision);
    const instruction = s.instruction.trim() ? s.instruction : undefined;
    ensure(s.pending.length || instruction, 'Add a review or an instruction');
    ensure(
      s.pending.every((d) => d.revision === s.revision),
      'Some reviews belong to another revision. Inspect the page, then recreate or remove stale reviews.',
      'STALE_REVISION',
      409,
    );
    ensure(
      s.feedback.length < LIMITS.feedback,
      'Session feedback limit reached; open a new session',
      'SESSION_FULL',
      413,
    );
    const feedback: Feedback = {
      id: randomUUID(),
      revision: s.revision,
      ...(instruction ? { instruction } : {}),
      reviews: s.pending.map((d) => d.review),
      status: 'queued',
      deliveries: 0,
    };
    this.commit({
      ...s,
      pending: [],
      instruction: '',
      feedback: [...s.feedback, feedback],
    });
    return feedback;
  }
  /** Deliver every unfinished feedback. Uncompleted feedback come back with the next delivery. */
  take(id: string): Delivered | { status: 'ended' } | null {
    const s = this.get(id);
    const unfinished = s.feedback
      .filter((e) => e.status !== 'completed')
      .slice(0, LIMITS.feedbackPerReceipt);
    if (!unfinished.length)
      return s.ended ? { status: 'ended' as const } : null;
    // The agent holds these feedback now, so it works on them.
    const delivery = {
      receipt: randomUUID(),
      feedbackIds: unfinished.map((e) => e.id),
      started: true,
    };
    const ids = new Set(delivery.feedbackIds);
    const updated = this.commit({
      ...s,
      delivery,
      feedback: s.feedback.map((e) =>
        ids.has(e.id)
          ? { ...e, status: 'delivered', deliveries: e.deliveries + 1 }
          : e,
      ),
    });
    // The agent gets what it needs to apply the feedback. Delivery state stays on the server.
    return {
      status: 'feedback',
      source: { kind: s.source.kind, value: s.source.value },
      receipt: delivery.receipt,
      feedback: updated.feedback
        .filter((e) => ids.has(e.id))
        .map(({ id, revision, instruction, reviews, deliveries }) => ({
          id,
          revision,
          ...(instruction ? { instruction } : {}),
          reviews,
          deliveries,
        })),
    };
  }
  /** Complete the feedback of a receipt. */
  complete(id: string, receipt: unknown) {
    const s = this.get(id);
    if (typeof receipt === 'string' && s.completed.includes(receipt)) return s;
    ensure(
      typeof receipt === 'string' && s.delivery?.receipt === receipt,
      'Receipt is unknown or replaced by a newer wait; do not complete newer work',
      'STALE_RECEIPT',
      409,
    );
    const ids = new Set(s.delivery!.feedbackIds);
    return this.commit({
      ...s,
      delivery: undefined,
      completed: [...s.completed, receipt as string],
      feedback: s.feedback.map((e) =>
        ids.has(e.id) ? { ...e, status: 'completed' } : e,
      ),
    });
  }
  end(id: string) {
    return this.commit({ ...this.get(id), ended: true });
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
