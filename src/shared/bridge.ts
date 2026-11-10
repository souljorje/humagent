/** postMessage contract between the page SDK and the workspace. The random channel identifies both sides. */
import type {
  Availability,
  Draft,
  DraftItem,
  DraftLabels,
  MarkerPosition,
  StageResult,
  Submission,
} from './feedback.js';

export interface Bootstrap {
  session: string;
  channel: string;
  parentOrigin: string;
  revision: string;
  sourceUrl: string;
  documentId: string;
}
export interface Presentation {
  drafts: Draft[];
  /** Text replacements that the page shows in place of the original text. */
  previews: Draft[];
  writable: boolean;
}

/** Page requests. The workspace answers each one with exactly one `result`. */
export interface Requests {
  /** A `key` makes this the one draft of a form. */
  stage: {
    params: {
      item: DraftItem;
      marker?: MarkerPosition;
      key?: string;
      labels?: DraftLabels;
    };
    result: StageResult;
  };
  edit: {
    params: { draftId: string; comment: string; after?: string };
    result: null;
  };
  remove: { params: { draftId: string }; result: null };
}
export interface PageEvents {
  hello: Record<string, never>;
  mode: { enabled: boolean };
  editing: { dirty: boolean };
  notice: { message: string };
  availability: { items: Availability[] };
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
  open: { draftId: string };
  highlight: { draftId?: string };
  outside: Record<string, never>;
  /** The human deletes a form's draft. The page resets the form, then removes the draft. */
  reset: { key: string; draftId: string };
}
export type WorkspaceMessage = { channel: string } & (
  | { method: 'result'; id: string; result?: unknown; error?: string }
  | Messages<WorkspaceEvents>
);

declare global {
  interface Window {
    __HUMAGENT__?: Bootstrap;
    humagent: Readonly<{ submit(value: Submission): Promise<StageResult> }>;
  }
}
