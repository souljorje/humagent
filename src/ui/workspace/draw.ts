/** What the bar and the page show of the workspace. */
import type { Presentation } from '@/shared/bridge';
import type { SavedReview, WorkspaceView } from '@/shared/feedback';
import {
  agentStatus,
  type AgentStatus,
  type BarModel,
  type SavedReviewModel,
} from './model';
import { isFresh, loadPage, post, type Workspace } from './state';

const AGENT_STATES: readonly AgentStatus[] = ['connected', 'sent', 'working'];

function pendingReview(w: Workspace, saved: SavedReview): SavedReviewModel {
  const stale = !isFresh(w, saved.revision);
  return {
    saved,
    stale,
    unavailable: !stale && w.available().get(saved.review.id) === false,
  };
}

function barModel(w: Workspace): BarModel {
  const session = w.session();
  const page = w.page();
  const sending = w.sending();
  const editorDirty = w.input.editorDirty();
  const status = agentStatus(session, w.connected());
  const agent = AGENT_STATES.includes(status);
  const pending =
    session?.pending.map((saved) => pendingReview(w, saved)) ?? [];
  return {
    status,
    agent,
    session,
    attached: !!page,
    changed: !!page && !!session && page.revision !== session.revision,
    pending,
    annotating: w.annotating(),
    editorDirty,
    send: sending ? 'Sending…' : w.sent() ? 'Sent' : 'Send',
    sendable:
      !sending &&
      agent &&
      !editorDirty &&
      isFresh(w, page?.revision) &&
      !pending.some((saved) => saved.stale),
    // An ended session accepts no instruction.
    instructionPending: !!session && !session.ended && w.instruction.pending(),
    instructionStatus: w.instruction.status(),
    error: w.message(),
    bridgeStatus: w.bridgeStatus(),
    connecting: w.connecting(),
    scrollbars: w.scrollbars(),
  };
}

export const presentation = (
  w: Workspace,
  { pending, sent, ended }: WorkspaceView,
): Presentation => ({
  bar: w.view?.barPosition() ?? { x: 0, y: 0 },
  pending,
  previews: [...pending, ...sent].filter((saved) => isFresh(w, saved.revision)),
  writable: !ended,
});

/**
 * An HTML file reloads on its own when its source changes, once per revision.
 * Unfinished or unsaved input blocks it. App pages keep the button: their HTML can differ on each request.
 */
function reloadChanged(w: Workspace, session: WorkspaceView) {
  const { source, revision } = session;
  if (
    source.kind !== 'file' ||
    w.input.editorDirty() ||
    w.input.unsaved() ||
    w.reloadedFor === revision
  )
    return;
  w.reloadedFor = revision;
  loadPage(w, session);
}

/** Send the page its presentation when it differs from the last one. */
function present(w: Workspace, session: WorkspaceView) {
  const params = presentation(w, session);
  const signature = JSON.stringify(params);
  if (!w.page() || w.lastPresentation === signature) return;
  w.lastPresentation = signature;
  post(w, 'update', params);
}

export function draw(w: Workspace) {
  const model = barModel(w);
  const session = w.session();
  if (session && model.changed) reloadChanged(w, session);
  w.view?.update(model);
  if (session) present(w, session);
}
