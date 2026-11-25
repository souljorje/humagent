/**
 * Workspace logic: session state, page attachment, and the feedback flow. It builds no markup.
 * The server owns all feedback. The workspace shows its latest view.
 */
import { errorMessage } from '@/shared/errors';
import type { SavedReview, WorkspaceView } from '@/shared/feedback';
import type { Plugin } from '@/shared/plugin';
import { effect, signal } from '@/shared/signal';
import { createSession } from '@/ui/session';
import { draw } from './draw';
import { editInstruction } from './instruction';
import type { BarActions, BarView } from './model';
import { connect } from './page';
import { send } from './send';
import {
  createState,
  fail,
  isFresh,
  loadPage,
  post,
  type Workspace,
} from './state';

const SYNC_INTERVAL = 1000;
const CONNECT_LIMIT = 8000;

async function sync(w: Workspace) {
  try {
    await w.server.read();
  } catch (error) {
    if (w.connected() || !w.session()) fail(w, errorMessage(error));
    w.connected.set(false);
    w.bridgeStatus.set('Disconnected');
  }
}

function update(w: Workspace, next: WorkspaceView) {
  const previous = w.session();
  w.session.set(next);
  w.connected.set(true);
  if (!previous) loadPage(w, next);
  // A restarted server has a new page origin.
  else if (previous.page.origin !== next.page.origin) {
    w.attaching = undefined;
    w.page.set(undefined);
    fail(w, 'The service restarted. Refresh the page to reconnect.');
  }
}

function typeInstruction(w: Workspace, value: string) {
  w.sent.set(false);
  editInstruction(w.instruction, value);
  // The field's text is not a signal. Send depends on it.
  w.render();
}

/** Show the error of a request. */
function showErrors(w: Workspace, request: Promise<unknown>) {
  request.catch((error) => fail(w, errorMessage(error)));
}

/** Reload only the page frame at its current address. */
function reload(w: Workspace) {
  const session = w.session();
  if (session) loadPage(w, session);
}

/** Without an attached page, nothing can confirm. Annotating is off. */
function annotate(w: Workspace, enabled: boolean, keyboard: boolean) {
  if (w.page()) post(w, 'annotate', { enabled, keyboard });
  else w.annotating.set(false);
}

/** A keyed review can have a pending save on the page. Let the page cancel it first. */
function remove(w: Workspace, { review, key, revision }: SavedReview) {
  const reviewId = review.id;
  if (key !== undefined && isFresh(w, revision))
    post(w, 'discard', { reviewId, revision });
  else showErrors(w, w.server.removeReview(reviewId, revision));
}

const actionsOf = (w: Workspace): BarActions => ({
  instruction: (value) => typeInstruction(w, value),
  send: () => void send(w),
  end: () => showErrors(w, w.server.end()),
  reload: () => reload(w),
  annotate: (enabled, keyboard) => annotate(w, enabled, keyboard),
  open: (reviewId) => post(w, 'open', { reviewId }),
  highlight: (reviewId) => post(w, 'highlight', reviewId ? { reviewId } : {}),
  remove: (saved) => remove(w, saved),
  outside: () => post(w, 'outside', {}),
  // The bar moved, so the page needs its new position.
  layout: () => w.render(),
});

function checkConnection(w: Workspace) {
  if (w.page()) return;
  w.connecting.set(false);
  fail(
    w,
    'The page did not connect. Check its security policy or local server.',
  );
}

/** Connect the bar, read the session, and keep it current. */
async function start(w: Workspace, bar: BarView) {
  w.view = bar;
  connect(w, bar);
  // One effect draws the bar after any signal that it shows changes.
  w.render = effect(() => draw(w));
  await sync(w);
  setInterval(() => void sync(w), SYNC_INTERVAL);
  setTimeout(() => checkConnection(w), CONNECT_LIMIT);
}

export function createWorkspace(
  id: string,
  plugins: ReadonlyMap<string, Plugin>,
) {
  const server = createSession(id, {
    view: (view) => update(workspace, view),
    failed: () => void sync(workspace),
  });
  const workspace = createState(plugins, server, signal(''));
  return {
    actions: actionsOf(workspace),
    start: (bar: BarView) => start(workspace, bar),
  };
}
