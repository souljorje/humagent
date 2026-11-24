/** postMessage contract between the page SDK and the workspace. The random channel identifies both sides. */
import type {
  Availability,
  SavedReview,
  NewReview,
  SaveResult,
} from './feedback.js';
import type { Json } from './json.js';

export interface Bootstrap {
  session: string;
  channel: string;
  parentOrigin: string;
  revision: string;
  sourceUrl: string;
  documentId: string;
}
export interface Presentation {
  /** Top-left corner of the workspace bar, in frame viewport pixels. */
  bar: { x: number; y: number };
  pending: SavedReview[];
  /** Pending reviews and sent reviews of the page's revision. Plugins show them in place on the page. */
  previews: SavedReview[];
  writable: boolean;
}

/** Page requests. The workspace answers each one with exactly one `result`. */
export interface Requests {
  /** A `key` makes this the one pending review of its kind with that key. `local` is the plugin's private data. */
  save: {
    params: { review: NewReview; key?: string; local?: Json };
    result: SaveResult;
  };
  edit: {
    params: { reviewId: string; comment: string; data?: Json };
    result: null;
  };
  /** Discard supplies the saved revision. An editor removes a review on its page revision. */
  remove: { params: { reviewId: string; revision?: string }; result: null };
}
export interface PageEvents {
  hello: Record<string, never>;
  annotating: { enabled: boolean };
  editing: { dirty: boolean };
  notice: { message: string };
  availability: { items: Availability[] };
  /** Scrollbar sizes in CSS pixels. The bar outside the frame keeps clear of them. */
  scrollbars: { right: number; bottom: number };
}
type Messages<T, Extra = unknown> = {
  [M in keyof T]: { method: M; params: T[M] } & Extra;
}[keyof T];
type RequestParams = { [M in keyof Requests]: Requests[M]['params'] };
export type PageMessage = {
  channel: string;
  documentId: string;
  revision: string;
} & (Messages<RequestParams, { id: string }> | Messages<PageEvents>);

export interface WorkspaceEvents {
  init: Presentation & { annotating: boolean };
  update: Presentation;
  annotate: { enabled: boolean; keyboard?: boolean };
  open: { reviewId: string };
  highlight: { reviewId?: string };
  outside: Record<string, never>;
  /** The human deletes a pending review that the page shows. The page cleans up, then removes the pending review. */
  discard: { reviewId: string; revision: string };
}
export type WorkspaceMessage = { channel: string } & (
  | { method: 'result'; id: string; result?: unknown; error?: string }
  | Messages<WorkspaceEvents>
);

declare global {
  interface Window {
    __HUMAGENT__?: Bootstrap;
  }
}
