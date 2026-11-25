/** What the workspace logic and the bar share. */
import type { SavedReview, WorkspaceView } from '@/shared/feedback';

export type AgentStatus =
  'ended' | 'offline' | 'connected' | 'sent' | 'working' | 'idle';
/** The connection state wins over the state that the server reports. */
export function agentStatus(
  current: WorkspaceView | undefined,
  connected: boolean,
): AgentStatus {
  if (current?.ended) return 'ended';
  if (!connected) return 'offline';
  return current?.agent ?? 'idle';
}
export interface SavedReviewModel {
  saved: SavedReview;
  /** The pending review belongs to another page revision. */
  stale: boolean;
  /** The page cannot find the pending review's target. */
  unavailable: boolean;
}
/** Everything the bar shows. */
export interface BarModel {
  status: AgentStatus;
  /** An agent can receive feedback. */
  agent: boolean;
  session?: WorkspaceView;
  /** A page document is attached. */
  attached: boolean;
  /** The source changed after the page loaded. */
  changed: boolean;
  pending: SavedReviewModel[];
  annotating: boolean;
  /** The page has unfinished input. */
  editorDirty: boolean;
  send: 'Send' | 'Sending…' | 'Sent';
  /** Send can run when the human has a pending review or an instruction. */
  sendable: boolean;
  /** The typed instruction is not saved yet. */
  instructionPending: boolean;
  instructionStatus: string;
  error: string;
  bridgeStatus: string;
  connecting: boolean;
  /** Scrollbar sizes of the page, in CSS pixels. */
  scrollbars: { right: number; bottom: number };
}
/** What the human does in the bar. */
export interface BarActions {
  instruction(value: string): void;
  send(): void;
  end(): void;
  reload(): void;
  /** Turn annotating on or off. The page confirms with its mode. */
  annotate(enabled: boolean, keyboard: boolean): void;
  open(reviewId: string): void;
  highlight(reviewId?: string): void;
  remove(saved: SavedReview): void;
  /** A press outside the page while the page has unfinished input. */
  outside(): void;
  /** The bar moved or changed size. */
  layout(): void;
}
/** What the logic asks of the bar view. */
export interface BarView {
  frame: HTMLIFrameElement;
  update(model: BarModel): void;
  /** Top-left corner of the bar, in frame viewport pixels. */
  barPosition(): { x: number; y: number };
  /** Load a page in the frame. Pending reviews stay in the bar. */
  load(url: string): void;
  focusToggle(): void;
}
