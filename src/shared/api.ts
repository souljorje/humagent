/** What the server, the workspace, and the agent's commands share about the control routes. */
import type { WorkspaceView } from './feedback';

/** The header that carries a session key. */
export const SESSION_HEADER = 'x-humagent-session';

/** The reply to each workspace write: the fresh session. */
export interface WriteReply {
  readonly session: WorkspaceView;
}
export interface SaveReply extends WriteReply {
  readonly reviewId: string;
}
/** The reply to an open. */
export interface OpenedSession {
  readonly session: string;
  /** The private workspace URL. Its fragment is the session key. */
  readonly url: string;
  /** A browser already shows the session. */
  readonly viewing: boolean;
  readonly source: WorkspaceView['source'];
  readonly note: string;
}
