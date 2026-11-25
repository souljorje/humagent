/** Feedback contracts shared by the server, the workspace, the page SDK, and agents. */
import type { Json } from './json.js';

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
  kind: 'file' | 'url';
  value: string;
  root?: string;
  network: boolean;
}
/**
 * Where a review points. The page SDK writes these fields. The server stores a target as it is, so each field can be missing.
 * A plugin can add fields of its own.
 */
export interface Target {
  id?: string;
  selector?: string;
  text?: string;
  url?: string;
  anchor?: { quote: string; prefix?: string; suffix?: string };
  coordinates?: { x: number; y: number; space: string };
}
/** One feedback review. `kind` names the plugin that made it. `data` holds that plugin's content. */
export interface Review {
  id: string;
  kind: string;
  comment?: string;
  data?: Json;
  target?: Target;
}
/** A review as the page sends it. The server adds `id`. */
export type NewReview = Omit<Review, 'id'>;
/** A review with the page revision that it belongs to. A pending review also has its key and local data. */
export interface SavedReview {
  review: Review;
  revision: string;
  /** A session holds at most one pending review per kind and key. A new pending review with a known key replaces it. */
  key?: string;
  /** The plugin's private data for the page and the bar. Agents do not receive it. */
  local?: Json;
}
/** What one Send delivers: the instruction and the reviews that were pending. The agent receives it without `status`. */
export interface Feedback {
  id: string;
  revision: string;
  instruction?: string;
  reviews: Review[];
  status: 'queued' | 'delivered' | 'completed';
  deliveries: number;
}
/** What the agent receives when it waits: every unfinished feedback, held by one receipt. */
export interface Delivered {
  status: 'feedback';
  source: Pick<Source, 'kind' | 'value'>;
  receipt: string;
  feedback: Omit<Feedback, 'status'>[];
}
export interface SessionView {
  id: string;
  title: string;
  source: Source;
  revision: string;
  ended: boolean;
  createdAt: string;
  agent: 'sent' | 'working' | 'connected' | 'idle';
  pending: SavedReview[];
  instruction: string;
  /** Sent reviews that are not completed. Plugins can keep showing them on the page. */
  sent: SavedReview[];
}
export interface WorkspaceView extends SessionView {
  /** Where the page is served: its own origin, its address, and the channel of its messages. */
  page: { origin: string; frameUrl: string; channel: string };
}
export interface SaveResult {
  reviewId: string;
  status: 'pending';
}
/** `saving` ends with a reply. `failed` lasts until the human changes the input or reloads the page. */
export type Unsaved = 'saving' | 'failed';
export interface Availability {
  id: string;
  available: boolean;
}
