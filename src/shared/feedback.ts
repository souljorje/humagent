/** Feedback contracts shared by the server, the workspace, the page SDK, and agents. */
import type { Json } from './json';
import type { MarkerPosition } from './marker';

export const LIMITS = {
  bodyBytes: 256 * 1024,
  pending: 100,
  feedback: 2000,
  feedbackPerReceipt: 100,
  comment: 4000,
  instruction: 4000,
  text: 50000,
  key: 200,
} as const;

export interface Source {
  readonly kind: 'file' | 'url';
  readonly value: string;
  readonly root?: string;
  readonly network: boolean;
}
/**
 * Where a review points. The page SDK writes these fields. The server stores a target as it is, so each field can be missing.
 * A plugin can add fields of its own.
 */
export interface Target {
  readonly id?: string;
  readonly selector?: string;
  readonly text?: string;
  readonly url?: string;
  readonly anchor?: {
    readonly quote: string;
    readonly prefix?: string;
    readonly suffix?: string;
  };
  readonly coordinates?: {
    readonly x: number;
    readonly y: number;
    readonly space: string;
  };
}
/** One feedback review. `kind` selects the plugin that reads its data. */
export interface Review {
  readonly id: string;
  readonly kind: string;
  readonly comment?: string;
  readonly data?: Json;
  readonly target?: Target;
}
/** A review as the page sends it. The server adds `id`. */
export type NewReview = Omit<Review, 'id'>;
/** A review with the page revision that it belongs to. A pending review also has its key and local data. */
export interface SavedReview {
  readonly review: Review;
  readonly revision: string;
  /** A session holds at most one pending review per kind and key. A new pending review with a known key replaces it. */
  readonly key?: string;
  /** The SDK's marker position for this target. */
  readonly marker?: MarkerPosition;
  /** The plugin's private data for the page and the bar. Agents do not receive it. */
  readonly local?: Json;
}
/** What one Send delivers: the instruction and the reviews that were pending. The agent receives it without `status`. */
export interface Feedback {
  readonly id: string;
  readonly revision: string;
  readonly instruction?: string;
  readonly reviews: readonly Review[];
  readonly status: 'queued' | 'delivered' | 'completed';
  readonly deliveries: number;
}
/** What the agent receives when it waits: every unfinished feedback, held by one receipt. */
export interface Delivered {
  readonly status: 'feedback';
  readonly source: Pick<Source, 'kind' | 'value'>;
  readonly receipt: string;
  readonly feedback: readonly Omit<Feedback, 'status'>[];
}
export interface SessionView {
  readonly id: string;
  readonly title: string;
  readonly source: Source;
  readonly revision: string;
  readonly ended: boolean;
  readonly createdAt: string;
  readonly agent: 'sent' | 'working' | 'connected' | 'idle';
  readonly pending: readonly SavedReview[];
  readonly instruction: string;
  /** Sent reviews that are not completed. Plugins can keep showing them on the page. */
  readonly sent: readonly SavedReview[];
}
export interface WorkspaceView extends SessionView {
  /** Where the page is served: its own origin, its address, and the channel of its messages. */
  readonly page: {
    readonly origin: string;
    readonly frameUrl: string;
    readonly channel: string;
  };
}
export interface SaveResult {
  readonly reviewId: string;
  readonly status: 'pending';
}
/** `saving` ends with a reply. `failed` lasts until the human changes the input or reloads the page. */
export type Unsaved = 'saving' | 'failed';
export interface Availability {
  readonly id: string;
  readonly available: boolean;
}
