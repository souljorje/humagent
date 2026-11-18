/** Feedback contracts shared by the server, the workspace, the page SDK, and agents. */
import type { ObjectValue } from './json.js';

export const LIMITS = {
  bodyBytes: 256 * 1024,
  drafts: 100,
  events: 2000,
  eventsPerReceipt: 100,
  comment: 4000,
  message: 4000,
  text: 50000,
  formKey: 200,
  label: 500,
  labelFields: 100,
} as const;

export interface Target {
  kind: 'file' | 'url';
  value: string;
  root?: string;
  network: boolean;
}
export type ReviewTarget = ObjectValue;
/** A stored review item. `take()` delivers it as a `FeedbackItem`. Content fields come before `target`. */
export interface ReviewItem {
  id: string;
  comment?: string;
  replacement?: { before: string; after: string };
  values?: ObjectValue;
  target?: ReviewTarget;
}
export type DraftItem = Omit<ReviewItem, 'id'>;
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
/** One Send action. The agent receives it as a `FeedbackEvent`, without `status`. */
export interface Event {
  id: string;
  revision: string;
  message?: string;
  items: ReviewItem[];
  status: 'queued' | 'delivered' | 'completed';
  deliveries: number;
}
/** A comment on the page element in `target`. */
export interface CommentFeedbackItem {
  id: string;
  kind: 'comment';
  comment: string;
  target: ReviewTarget;
}
/** A proposed text change to the element in `target`. An empty `after` proposes deletion. */
export interface EditFeedbackItem {
  id: string;
  kind: 'edit';
  /** The reviewer's own note. Absent when empty. */
  comment?: string;
  edit: { before: string; after: string };
  target: ReviewTarget;
}
/** Named answers from a form. `target.id` is the form key of a marked form. */
export interface FormFeedbackItem {
  id: string;
  kind: 'form';
  /** `instruction` is the page's text for the form. It is absent when empty. */
  form: { instruction?: string; values: ObjectValue };
  target?: { id: string };
}
/** One delivered item. `kind` names the key that holds its content. */
export type FeedbackItem =
  | CommentFeedbackItem
  | EditFeedbackItem
  | FormFeedbackItem;
/** One Send action, as the agent receives it. */
export interface FeedbackEvent {
  id: string;
  revision: string;
  /** The overall instruction. Absent when empty. */
  message?: string;
  items: FeedbackItem[];
  /** How often `wait` returned this event. A value above 1 means a redelivery. */
  deliveries: number;
}
/** The result of `humagent wait` when the human sends feedback. */
export interface Feedback {
  status: 'feedback';
  target: { kind: Target['kind']; value: string };
  receipt: string;
  events: FeedbackEvent[];
}
export interface SessionView {
  id: string;
  title: string;
  target: Target;
  revision: string;
  ended: boolean;
  createdAt: string;
  agent: 'working' | 'waiting' | 'idle';
  drafts: Draft[];
  message: string;
  /** Text replacements that were sent but not completed. Pages keep previewing them. */
  sent: Draft[];
}
export interface WorkspaceView extends SessionView {
  surface: { origin: string; frameUrl: string; channel: string };
}
export interface Submission {
  values: ObjectValue;
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
