import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  LIMITS,
  type SavedReview,
  type Delivered,
  type Feedback,
  type SessionView,
  type Source,
} from '@/shared/feedback';
import type { ObjectValue } from '@/shared/json';
import { isMarkerPosition } from '@/shared/marker';
import {
  ensure,
  envelope,
  Failure,
  reviewComment,
  reviewFields,
  text,
} from '@/shared/validate';
import { writeJson } from '@/server/storage';
import { ensureReviewContent } from '@/server/validate';
import {
  FORMAT,
  current,
  readSession,
  sessionView,
  type Session,
} from './session';

type Taken = Delivered | { status: 'ended' };
type WaitResult = Taken | { status: 'interrupted' };
type Waiter = PromiseWithResolvers<WaitResult>;

const INTERRUPTED: WaitResult = { status: 'interrupted' };

/** Single-process writer. Each change is saved atomically before a waiting agent hears about it. */
export class Store {
  private sessions = new Map<string, Session>();
  private failures = new Map<string, string>();
  /** At most one agent waits per session. */
  private waiting = new Map<string, Waiter>();
  private directory: string;
  constructor(home: string) {
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
    return Array.from(this.failures, ([id, message]) => ({ id, message }));
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
    // A delivery runs after the caller finishes, so it can commit without re-entering itself.
    queueMicrotask(() => this.deliver(s.id));
    return s;
  }
  private writable(id: string) {
    const s = this.get(id);
    ensure(!s.ended, 'Session has ended', 'ENDED', 410);
    return s;
  }
  view(id: string): SessionView {
    return sessionView(this.get(id), this.waiting.has(id));
  }
  private saved(s: Session, reviewId: string) {
    const saved = s.pending.find((d) => d.review.id === reviewId);
    if (!saved) throw new Failure(404, 'NOT_FOUND', 'Review not found');
    return saved;
  }
  open(source: Source, revision: string) {
    const existing = this.sessions
      .values()
      .find(
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
  addReview(id: string, value: ObjectValue) {
    const s = this.writable(id);
    current(s, value.revision);
    const review = envelope(value.review);
    const key =
      value.key === undefined
        ? undefined
        : text(value.key, 'Review key', LIMITS.key);
    const index =
      key === undefined
        ? -1
        : s.pending.findIndex(
            (d) => d.key === key && d.review.kind === review.kind,
          );
    const previous = s.pending[index];
    ensure(
      previous || s.pending.length < LIMITS.pending,
      `Send or remove pending reviews before adding more than ${LIMITS.pending}.`,
      'SESSION_FULL',
      413,
    );
    ensureReviewContent(review);
    const { marker } = value;
    ensure(
      marker === undefined || (review.target && isMarkerPosition(marker)),
      'Invalid marker position',
    );
    const saved: SavedReview = {
      review: { id: previous?.review.id ?? randomUUID(), ...review },
      revision: s.revision,
      ...(key !== undefined ? { key } : {}),
      ...(marker !== undefined ? { marker: { x: marker.x, y: marker.y } } : {}),
      ...(value.local !== undefined ? { local: value.local } : {}),
    };
    if (JSON.stringify(previous) !== JSON.stringify(saved))
      this.commit({
        ...s,
        pending: previous
          ? s.pending.with(index, saved)
          : [...s.pending, saved],
      });
    return saved.review.id;
  }
  /**
   * Edit a pending review. The edit keeps the review ID, kind, key, target, private data, and list position.
   * It replaces the comment, and the data when the edit gives data.
   */
  editReview(id: string, reviewId: string, value: ObjectValue) {
    const s = this.writable(id);
    current(s, value.revision);
    const saved = this.saved(s, reviewId);
    current(s, saved.revision);
    const review = {
      id: reviewId,
      ...reviewFields({
        ...saved.review,
        comment: reviewComment(value.comment),
        data: value.data === undefined ? saved.review.data : value.data,
      }),
    };
    ensureReviewContent(review);
    this.commit({
      ...s,
      pending: s.pending.map((d) => (d === saved ? { ...saved, review } : d)),
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
  take(id: string): Taken | null {
    const s = this.get(id);
    const batch = new Map<string, Feedback>();
    for (const item of s.feedback) {
      if (item.status === 'completed') continue;
      batch.set(item.id, {
        ...item,
        status: 'delivered',
        deliveries: item.deliveries + 1,
      });
      if (batch.size === LIMITS.feedbackPerReceipt) break;
    }
    if (!batch.size) return s.ended ? { status: 'ended' as const } : null;
    const receipt = randomUUID();
    this.commit({
      ...s,
      delivery: { receipt, feedbackIds: [...batch.keys()], started: true },
      feedback: s.feedback.map((item) => batch.get(item.id) ?? item),
    });
    // The agent gets what it needs to apply the feedback. Delivery state stays on the server.
    return {
      status: 'feedback',
      source: { kind: s.source.kind, value: s.source.value },
      receipt,
      feedback: Array.from(
        batch.values(),
        ({ id, revision, instruction, reviews, deliveries }) => ({
          id,
          revision,
          ...(instruction ? { instruction } : {}),
          reviews,
          deliveries,
        }),
      ),
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
  wait(id: string, signal: AbortSignal): Promise<WaitResult> {
    ensure(
      !this.waiting.has(id),
      'Another agent is already waiting',
      'LISTENER_ACTIVE',
      409,
    );
    if (signal.aborted) return Promise.resolve(INTERRUPTED);
    const immediate = this.take(id);
    return immediate ? Promise.resolve(immediate) : this.start(id, signal);
  }
  private start(id: string, signal: AbortSignal) {
    const waiter: Waiter = Promise.withResolvers();
    this.waiting.set(id, waiter);
    signal.addEventListener('abort', () => this.interrupt(id, waiter), {
      once: true,
    });
    return waiter.promise;
  }
  /** Give a waiting agent what it can take now. */
  private deliver(id: string) {
    const waiter = this.waiting.get(id);
    if (!waiter) return;
    try {
      const next = this.take(id);
      if (next) this.settle(id, waiter, next);
    } catch (error) {
      this.waiting.delete(id);
      waiter.reject(error);
    }
  }
  private settle(id: string, waiter: Waiter, result: WaitResult) {
    this.waiting.delete(id);
    waiter.resolve(result);
  }
  /** End a wait that did not end yet. */
  private interrupt(id: string, waiter: Waiter) {
    if (this.waiting.get(id) === waiter) this.settle(id, waiter, INTERRUPTED);
  }
  /** Interrupt every waiting agent. */
  interruptWaits() {
    for (const [id, waiter] of this.waiting) this.interrupt(id, waiter);
  }
}
