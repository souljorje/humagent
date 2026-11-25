/** The plugins of this page document, and their part in each message of the workspace. */
import type { Presentation, Requests, WorkspaceEvents } from '@/shared/bridge';
import { errorMessage } from '@/shared/errors';
import type { NewReview, SavedReview, Unsaved } from '@/shared/feedback';
import { cloneJson } from '@/shared/json';
import type { PagePlugin, Plugin, PluginView } from '@/shared/plugin';
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
  /** The page half of each plugin, by kind. */
  readonly pages: Map<string, PagePlugin>;
  readonly unsaved: Map<string, Unsaved | undefined>;
  /** The state of unsaved input that the workspace knows. */
  reported: Unsaved | null;
  initialized: boolean;
  pending: readonly SavedReview[];
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

/** The workspace gets one state for all plugins. Saving comes before failed. */
function reportUnsaved(host: Host, kind: string, state?: Unsaved) {
  host.unsaved.set(kind, state);
  const states = [...host.unsaved.values()];
  const next =
    (['saving', 'failed'] as const).find((item) => states.includes(item)) ??
    null;
  if (next === host.reported) return;
  host.reported = next;
  post(host.bridge, 'unsaved', { state: next });
}

function startPlugin(host: Host, kind: string, plugin: Plugin) {
  const { annotator, bridge, pages } = host;
  const page = plugin.page?.({
    attribute: `data-humagent-${kind}`,
    annotating: pluginApi(annotator),
    notice: (message) => notice(bridge, message),
    unsaved: (state) => reportUnsaved(host, kind, state),
    save: (review, options) => save(bridge, { ...review, kind }, options),
  });
  if (!page) return;
  pages.set(kind, page);
  if (page.tool) annotator.tools.push({ ...page.tool, kind });
}

/** The members of `window.humagent`. Two plugins cannot add one member. */
function pageApi(pages: Iterable<PagePlugin>) {
  const api: Record<string, unknown> = {};
  for (const page of pages)
    for (const [name, member] of Object.entries(page.api ?? {})) {
      if (Object.hasOwn(api, name))
        throw new Error(`Duplicate page API member: ${name}`);
      api[name] = member;
    }
  return Object.freeze(api) as Window['humagent'];
}

/** Each plugin gets the feedback of its own kind. */
const pluginView = (
  { bridge }: Host,
  kind: string,
  { pending, previews, writable }: Presentation,
): PluginView => ({
  pending: pending.filter(
    (saved) =>
      saved.review.kind === kind && saved.revision === bridge.boot.revision,
  ),
  previews: previews.filter((saved) => saved.review.kind === kind),
  writable,
});

function update(host: Host, params: Presentation) {
  host.bridge.ended = !params.writable;
  host.pending = params.pending;
  for (const [kind, page] of host.pages)
    page.present?.(pluginView(host, kind, params));
  present(host.annotator, params);
}

function init(host: Host, params: WorkspaceEvents['init']) {
  if (!host.initialized) {
    host.initialized = true;
    clearInterval(host.hello);
    for (const [kind, page] of host.pages)
      page.init?.(pluginView(host, kind, params));
    host.bridge.ready.resolve();
    // The workspace ignores reports from before the page attached.
    if (host.reported) post(host.bridge, 'unsaved', { state: host.reported });
  }
  update(host, params);
  setMode(host.annotator, params.annotating);
}

function annotate(
  { annotator, bridge }: Host,
  { enabled, keyboard }: WorkspaceEvents['annotate'],
) {
  if (!bridge.ended) setMode(annotator, enabled, keyboard);
}

function discard(
  { bridge, pages, pending }: Host,
  { reviewId, revision }: WorkspaceEvents['discard'],
) {
  const saved = pending.find(({ review }) => review.id === reviewId);
  if (saved?.revision === revision && revision === bridge.boot.revision)
    pages.get(saved.review.kind)?.discard?.(saved);
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
export function startHost(
  bridge: Bridge,
  plugins: ReadonlyMap<string, Plugin>,
): Host {
  const annotator = createAnnotating({
    boot: bridge.boot,
    post: (method, params) => post(bridge, method, params),
    notice: (message) => notice(bridge, message),
    save: (review, options) => save(bridge, review, options),
    edit: (params) => request(bridge, 'edit', cloneJson(params)),
    remove: (reviewId) => request(bridge, 'remove', { reviewId }),
  });
  const host: Host = {
    bridge,
    annotator,
    pages: new Map(),
    unsaved: new Map(),
    reported: null,
    initialized: false,
    pending: [],
  };
  for (const [kind, plugin] of plugins) startPlugin(host, kind, plugin);
  window.humagent = pageApi(host.pages.values());
  return host;
}

/** Ask the workspace to attach the page, until it does. */
export function attach(host: Host) {
  const hello = () => post(host.bridge, 'hello', {});
  host.hello = setInterval(hello, HELLO_INTERVAL);
  hello();
}
