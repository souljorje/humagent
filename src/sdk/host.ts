/** The plugins of this page document, and their part in each message of the workspace. */
import type { Presentation, Requests, WorkspaceEvents } from '@/shared/bridge';
import { errorMessage } from '@/shared/errors';
import type { NewReview, Unsaved } from '@/shared/feedback';
import { cloneJson } from '@/shared/json';
import type { pageInputs, PageView } from '@/plugins/inputs';
import { effect, signal, type Signal } from '@/shared/signal';
import {
  createAnnotating,
  pluginApi,
  present,
  type Annotator,
} from './annotating/annotating';
import { pressOutside } from './annotating/capture';
import { setMode } from './annotating/mode';
import { openReview } from './annotating/picking';
import { highlight } from './annotating/placement';
import { post, request, type Bridge, type Handlers } from './bridge';

const HELLO_INTERVAL = 1000;

interface Host {
  readonly bridge: Bridge;
  readonly annotator: Annotator;
  readonly inputs: ReturnType<typeof pageInputs>;
  readonly view: Signal<PageView>;
  readonly unsaved: Signal<Unsaved | null>;
  hello?: ReturnType<typeof setInterval>;
}

function notice(bridge: Bridge, message: string) {
  post(bridge, 'notice', { message });
}

const save = (
  bridge: Bridge,
  review: NewReview,
  { key, local, marker }: Omit<Requests['save']['params'], 'review'> = {},
) =>
  request(bridge, 'save', {
    review: cloneJson(review),
    key,
    marker,
    local: local === undefined ? undefined : cloneJson(local),
  });

function update(host: Host, params: Presentation) {
  const { boot } = host.bridge;
  host.bridge.ended = !params.writable;
  host.view.set({
    pending: params.pending.filter((saved) => saved.revision === boot.revision),
    previews: params.previews,
    writable: params.writable,
  });
  present(host.annotator, params);
}

function init(host: Host, params: WorkspaceEvents['init']) {
  update(host, params);
  if (host.hello !== undefined) {
    clearInterval(host.hello);
    host.hello = undefined;
    host.inputs.restore();
    effect(() => post(host.bridge, 'unsaved', { state: host.unsaved() }));
    host.bridge.ready.resolve();
  }
  setMode(host.annotator, params.annotating);
}

function annotate(
  { annotator, bridge }: Host,
  { enabled, keyboard }: WorkspaceEvents['annotate'],
) {
  if (!bridge.ended) setMode(annotator, enabled, keyboard);
}

function discard(
  { bridge, inputs, view }: Host,
  { reviewId, revision }: WorkspaceEvents['discard'],
) {
  const saved = view().pending.find(({ review }) => review.id === reviewId);
  if (saved?.revision === revision) inputs.discard(saved);
  // Page requests stay in order, so a save sent earlier cannot recreate the pending review.
  request(bridge, 'remove', { reviewId, revision }).catch((error: unknown) =>
    notice(bridge, errorMessage(error)),
  );
}

export const handlersOf = (host: Host): Handlers => ({
  init: (params) => init(host, params),
  update: (params) => update(host, params),
  annotate: (params) => annotate(host, params),
  open: ({ reviewId }) => openReview(host.annotator, reviewId),
  highlight: ({ reviewId }) => highlight(host.annotator, reviewId),
  outside: () => void pressOutside(host.annotator),
  discard: (params) => discard(host, params),
});

/** Start the plugins of this page. */
export function startHost(bridge: Bridge, install: typeof pageInputs): Host {
  const annotator = createAnnotating({
    boot: bridge.boot,
    post: (method, params) => post(bridge, method, params),
    notice: (message) => notice(bridge, message),
    save: (review, options) => save(bridge, review, options),
    edit: (params) => request(bridge, 'edit', cloneJson(params)),
    remove: (reviewId) => request(bridge, 'remove', { reviewId }),
  });
  const view = signal<PageView>({ pending: [], previews: [], writable: false });
  const unsaved = signal<Unsaved | null>(null);
  const inputs = install(pluginApi(annotator), view, {
    save: (review, options) => save(bridge, review, options),
    notice: (message) => notice(bridge, message),
    unsaved: (state) => unsaved.set(state ?? null),
  });
  annotator.tools.push(...inputs.tools);
  window.humagent = inputs.api;
  return { bridge, annotator, inputs, view, unsaved };
}

/** Ask the workspace to attach the page, until it does. */
export function attach(host: Host) {
  const hello = () => post(host.bridge, 'hello', {});
  host.hello = setInterval(hello, HELLO_INTERVAL);
  hello();
}
