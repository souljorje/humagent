/** Feedback contracts shared by the server, the workspace, the page SDK, and agents. */
import type { ObjectValue } from './json.js';

export const LIMITS = {
  bodyBytes: 256 * 1024,
  drafts: 100,
  events: 2000,
  eventsPerReceipt: 100,
  comment: 4000,
  instruction: 4000,
  text: 50000,
  formKey: 200,
  label: 500,
  labelFields: 100,
} as const;

export interface Source {
  kind: 'file' | 'url';
  value: string;
  root?: string;
  network: boolean;
}
export type ReviewTarget = ObjectValue;
/** One feedback item. `kind` names the key that holds its content. */
export interface ReviewItem {
  id: string;
  kind: 'comment' | 'edit' | 'form';
  comment?: string;
  edit?: { before: string; after: string };
  form?: ObjectValue;
  target?: ReviewTarget;
}
/** An item as the page sends it. The server adds `id` and `kind`. */
export type NewItem = Omit<ReviewItem, 'id' | 'kind'>;
/** Where the human clicked, relative to the target's top-left corner. */
export interface MarkerPosition {
  x: number;
  y: number;
}
/** Readable text for a form draft in the bar. Agents do not receive it. */
export interface DraftLabels {
  title: string;
  fields: { label: string; value: string }[];
}
/** Unsent feedback for the page revision that the human saw. */
export interface Draft {
  item: ReviewItem;
  revision: string;
  marker?: MarkerPosition;
  /** A form's identity. A session holds at most one draft per key. */
  key?: string;
  labels?: DraftLabels;
}
/** One Send action. The agent receives it without `status`. */
export interface Event {
  id: string;
  revision: string;
  instruction?: string;
  items: ReviewItem[];
  status: 'queued' | 'delivered' | 'completed';
  deliveries: number;
}
/** What `wait` returns when the human sends feedback. */
export interface Feedback {
  status: 'feedback';
  source: Pick<Source, 'kind' | 'value'>;
  receipt: string;
  events: Omit<Event, 'status'>[];
}
export interface SessionView {
  id: string;
  title: string;
  source: Source;
  revision: string;
  ended: boolean;
  createdAt: string;
  agent: 'working' | 'connected' | 'idle';
  drafts: Draft[];
  instruction: string;
  /** Text edits that were sent but not completed. Pages keep previewing them. */
  sent: Draft[];
}
export interface WorkspaceView extends SessionView {
  surface: { origin: string; frameUrl: string; channel: string };
}
export interface Submission {
  form: ObjectValue;
  comment?: string;
}
export interface StageResult {
  draftId: string;
  status: 'draft';
}
export interface Availability {
  id: string;
  available: boolean;
}
