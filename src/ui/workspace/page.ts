/** The page in the frame: its attachment, its requests, and its events. */
import type { PageEvents, PageMessage, Requests } from '@/shared/bridge';
import { errorMessage } from '@/shared/errors';
import type { SaveResult } from '@/shared/feedback';
import { connectPage } from '@/ui/page-bridge';
import { prepareEdit, prepareSave } from '@/ui/reviews';
import { presentation } from './draw';
import type { BarView } from './model';
import { reportInput, resetInput } from './page-input';
import { fail, post, type Workspace } from './state';

type Params<M extends keyof Requests> = Requests[M]['params'];

const MAX_SCROLLBAR = 40;

/** Attach a page document. The SDK repeats `hello` until `init` arrives, so a failed attach retries. */
async function attach(w: Workspace, { documentId, revision }: PageMessage) {
  if (documentId === w.attaching) return;
  w.attaching = documentId;
  // The bar stops guarding the old page's unfinished input.
  w.page.set(undefined);
  resetInput(w.input);
  w.lastPresentation = '';
  w.available.set(new Map());
  try {
    await w.server.attachPage(documentId);
  } catch (error) {
    if (w.attaching !== documentId) return;
    w.attaching = undefined;
    fail(w, errorMessage(error));
    return;
  }
  const session = w.session();
  if (w.attaching !== documentId || !session) return;
  w.page.set({ documentId, revision });
  w.connecting.set(false);
  w.bridgeStatus.set('Page connected');
  const params = presentation(w, session);
  w.lastPresentation = JSON.stringify(params);
  post(w, 'init', { ...params, annotating: w.annotating() });
}

const pendingOf = ({ session }: Workspace) => session()?.pending ?? [];

/** The page is not trusted. Each review passes the rules of its plugin before the server saves it. */
async function saveReview(
  w: Workspace,
  params: Params<'save'>,
  revision: string,
): Promise<SaveResult> {
  const checked = prepareSave(w.plugins, pendingOf(w), params);
  const { reviewId } = await w.server.saveReview({ ...checked, revision });
  w.sent.set(false);
  fail(w);
  return { reviewId, status: 'pending' };
}

async function editReview(
  w: Workspace,
  params: Params<'edit'>,
  revision: string,
) {
  const changes = prepareEdit(w.plugins, pendingOf(w), params);
  await w.server.editReview(params.reviewId, { ...changes, revision });
  return null;
}

async function removeReview(
  { server }: Workspace,
  { reviewId, revision }: Params<'remove'>,
  pageRevision: string,
) {
  await server.removeReview(reviewId, revision ?? pageRevision);
  return null;
}

/** The page confirms the mode. */
function onAnnotating(w: Workspace, { enabled }: PageEvents['annotating']) {
  w.annotating.set(enabled);
  if (!enabled) w.view?.focusToggle();
}

function onAvailability(
  { available }: Workspace,
  { items }: PageEvents['availability'],
) {
  const changes = items.map((item) => [item.id, item.available] as const);
  available.set(new Map([...available(), ...changes]));
}

/** Page input: keep each size between 0 and 40 pixels. */
const scrollbarSize = (value: number) =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), MAX_SCROLLBAR) : 0;

function onScrollbars(
  { scrollbars }: Workspace,
  { right, bottom }: PageEvents['scrollbars'],
) {
  scrollbars.set({
    right: scrollbarSize(right),
    bottom: scrollbarSize(bottom),
  });
}

export function connect(w: Workspace, { frame }: BarView) {
  connectPage({
    frame,
    page: () => w.session()?.page,
    attached: (msg) => msg.documentId === w.page()?.documentId,
    hello: (msg) => void attach(w, msg),
    failed: (message) => fail(w, message),
    requests: {
      save: (params, revision) => saveReview(w, params, revision),
      edit: (params, revision) => editReview(w, params, revision),
      remove: (params, revision) => removeReview(w, params, revision),
    },
    events: {
      annotating: (params) => onAnnotating(w, params),
      editing: ({ dirty }) => w.input.editorDirty.set(dirty),
      unsaved: ({ state }) => reportInput(w.input, state),
      notice: ({ message }) => fail(w, message),
      availability: (params) => onAvailability(w, params),
      scrollbars: (params) => onScrollbars(w, params),
    },
  });
}
