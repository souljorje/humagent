/** Feedback contracts shared by the server, the workspace, the page SDK, and agents. */
import type { ObjectValue } from './json.js';

export const LIMITS = {
  bodyBytes: 256 * 1024,
  drafts: 100,
  events: 2000,
  eventsPerReceipt: 100,
  comment: 4000,
  message: 4000,
  intent: 200,
  text: 50000,
  formKey: 200,
  label: 500,
  labelFields: 100,
  consumer: 100,
  leaseMs: { default: 120000, min: 1000, max: 3600000 },
  waitMs: { default: 50000, min: 1, max: 600000 },
} as const;

export interface Target {
  kind: 'file' | 'url';
  value: string;
  root?: string;
  network: boolean;
}
export type ReviewTarget = ObjectValue & { revision?: string };
export interface ReviewItem {
  id: string;
  target?: ReviewTarget;
  comment?: string;
  replacement?: { before: string; after: string };
  intent?: string;
  values?: ObjectValue;
}
export type DraftItem = Omit<ReviewItem, 'id'>;
export interface MarkerPosition {
  x: number;
  y: number;
  textOffset?: number;
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
/** One Send action, as the agent receives it. */
export interface Event {
  id: string;
  createdAt: string;
  revision: string;
  message?: string;
  items: ReviewItem[];
  status: 'queued' | 'delivered' | 'completed';
  deliveries: number;
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
  intent: string;
  values: ObjectValue;
  message?: string;
}
export interface StageResult {
  draftId: string;
  status: 'draft';
}
export interface Availability {
  id: string;
  available: boolean;
}
