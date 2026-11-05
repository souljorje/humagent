import type { DraftItem } from './batch.js';
import type {
  Availability,
  Draft,
  FormState,
  StageResult,
  StateResult,
  Submission,
} from './review.js';

export interface Bootstrap {
  protocol: 2;
  session: string;
  channel: string;
  parentOrigin: string;
  revision: string;
  sourceUrl: string;
  documentId: string;
}
export interface Requests {
  stage: { params: { item: DraftItem }; result: StageResult };
  state: {
    params: { state: FormState; expectedVersion: number };
    result: StateResult;
  };
  readState: { params: Record<string, never>; result: StateResult };
}
export type RequestResult = Requests[keyof Requests]['result'];
type RequestMessage = {
  [M in keyof Requests]: {
    method: M;
    params: Requests[M]['params'];
    id: string;
  };
}[keyof Requests];
interface Channel {
  humagent: 1;
  channel: string;
}
export type PageMessage = Channel &
  Pick<Bootstrap, 'revision' | 'sourceUrl' | 'documentId'> &
  (
    | RequestMessage
    | { method: 'hello' | 'pickerDone'; params: Record<string, never> }
    | { method: 'notice'; params: { message: string } }
    | { method: 'availability'; params: { items: Availability[] } }
    | {
        method: 'flushed';
        params: { ok?: boolean; error?: string };
        id: string;
      }
  );
export type WorkspaceMessage = Channel &
  (
    | { method: 'result'; id: string; result: RequestResult; error?: never }
    | { method: 'result'; id: string; result?: never; error: string }
    | {
        method: 'init';
        params: StateResult & { ended: boolean; drafts: Draft[] };
      }
    | { method: 'drafts'; params: { items: Draft[] } }
    | { method: 'pick' | 'ended' | 'reload' }
    | { method: 'flush'; id: string }
  );

declare global {
  interface Window {
    __HUMAGENT__?: Bootstrap;
    humagent: Readonly<{ submit(value: Submission): Promise<StageResult> }>;
  }
}
