import type { Input, ReviewItem } from './batch.js';
import type { ObjectValue } from './json.js';

export interface Draft {
  item: ReviewItem;
  revision: string;
}
export interface OverallInstruction {
  text: string;
  revision: string | null;
  token: string;
}
export interface PendingBatch {
  batch: Input;
  draftIds: string[];
  messageToken: string;
  uncertain?: boolean;
  rejected?: boolean;
  error?: string;
}
export interface ReviewState {
  format: 2;
  drafts: Draft[];
  message: OverallInstruction;
  outbox: PendingBatch[];
  staged: Record<string, { id: string; signature: string }>;
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
export type FormState = ObjectValue & { forms?: Record<string, ObjectValue> };
export interface StateResult {
  state: FormState;
  stateVersion: number;
}
export interface Availability {
  id: string;
  available: boolean;
}
