/** One session: its stored form, its revision rule, and what the workspace sees of it. */
import type {
  Feedback,
  SavedReview,
  SessionView,
  Source,
} from '../../shared/feedback.js';
import { ensure, object } from '../../shared/validate.js';
import { localUrl } from '../validate.js';

export const FORMAT = 4;

/** The feedback that the last `wait` returned. They stay unfinished until the agent completes this receipt. */
interface Delivery {
  readonly receipt: string;
  readonly feedbackIds: readonly string[];
  readonly started?: boolean;
}
export interface Session {
  readonly id: string;
  readonly title: string;
  readonly source: Source;
  readonly sessionKey: string;
  readonly revision: string;
  readonly pagePath?: string;
  readonly ended: boolean;
  readonly createdAt: string;
  readonly pending: readonly SavedReview[];
  readonly instruction: string;
  readonly feedback: readonly Feedback[];
  readonly delivery?: Delivery;
  readonly completed: readonly string[];
}

/** A stored file source has its directory. A stored app source has a local URL. */
function validSource(source: Source | undefined) {
  if (
    !source ||
    typeof source.value !== 'string' ||
    typeof source.network !== 'boolean'
  )
    return false;
  return source.kind === 'url'
    ? localUrl(new URL(source.value))
    : source.kind === 'file' && typeof source.root === 'string';
}
/** A stored page path stays on the page's origin. */
function validPagePath(pagePath: unknown) {
  return (
    pagePath === undefined ||
    (typeof pagePath === 'string' &&
      pagePath.startsWith('/') &&
      !pagePath.startsWith('//') &&
      !pagePath.includes('\\'))
  );
}
export function readSession(saved: unknown, id: string): Session {
  object(saved);
  const s = saved.session as unknown as Session | undefined;
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
      validSource(s.source) &&
      validPagePath(s.pagePath),
    'Unsupported or corrupt session',
  );
  // A previous process cannot confirm that the agent is still working.
  return s.delivery ? { ...s, delivery: { ...s.delivery, started: false } } : s;
}
/** Stale input is never rebound to a newer page revision. */
export function current(s: Session, revision: unknown) {
  ensure(
    revision === s.revision,
    'The page changed. Refresh it and inspect stale reviews.',
    'STALE_REVISION',
    409,
  );
}

/** What the session is doing. `waiting` says that an agent waits for feedback. */
function activity(s: Session, waiting: boolean): SessionView['agent'] {
  if (s.delivery?.started) return 'working';
  if (s.feedback.some((feedback) => feedback.status !== 'completed'))
    return 'sent';
  return waiting ? 'connected' : 'idle';
}
export function sessionView(s: Session, waiting: boolean): SessionView {
  return {
    id: s.id,
    title: s.title,
    source: s.source,
    revision: s.revision,
    ended: s.ended,
    createdAt: s.createdAt,
    agent: activity(s, waiting),
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
