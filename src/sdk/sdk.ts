/** The page host: bridge to the workspace, and the plugins of this page document. */
import { cloneJson } from '../shared/json.js';
import { createAnnotating } from './annotating.js';
import {
  BOOTSTRAP_ID,
  type Bootstrap,
  type Presentation,
  type Requests,
  type WorkspaceEvents,
  type WorkspaceMessage,
} from '../shared/bridge.js';
import type { NewReview, SavedReview, Unsaved } from '../shared/feedback.js';
import type { PagePlugin, PluginView } from '../shared/plugin.js';
import { plugins } from '../plugins/index.js';
import { errorMessage } from '../shared/errors.js';

if (window.parent === window.top) {
  const bootstrap = document.getElementById(BOOTSTRAP_ID)?.textContent;
  if (!bootstrap || window.parent === window)
    throw new Error('Humagent SDK requires an attached workspace');
  const boot: Bootstrap = JSON.parse(bootstrap);
  let initialized = false,
    ended = false,
    resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const calls = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  function post(method: string, params: unknown, id?: string) {
    parent.postMessage(
      {
        channel: boot.channel,
        documentId: boot.documentId,
        revision: boot.revision,
        method,
        params,
        ...(id ? { id } : {}),
      },
      boot.parentOrigin,
    );
  }
  /** Same-window messages are not lost, so each request is sent once and answered once. */
  async function request<M extends keyof Requests>(
    method: M,
    params: Requests[M]['params'],
  ): Promise<Requests[M]['result']> {
    await ready;
    if (ended) throw new Error('The session has ended');
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      calls.set(id, { resolve: resolve as (value: unknown) => void, reject });
      post(method, params, id);
    });
  }
  const notice = (message: string) => post('notice', { message });
  function save(
    review: NewReview,
    { key, local }: Omit<Requests['save']['params'], 'review'> = {},
  ) {
    return request('save', {
      review: cloneJson(review),
      key,
      local: local === undefined ? undefined : cloneJson(local),
    });
  }
  const annotating = createAnnotating({
    boot,
    post,
    notice,
    save,
    edit: (params) => request('edit', cloneJson(params)),
    remove: (reviewId) => request('remove', { reviewId }),
  });
  const pages = new Map<string, PagePlugin>();
  const unsaved = new Map<string, Unsaved | undefined>();
  let reported: Unsaved | null = null;
  /** The workspace gets one state for all plugins. Saving comes before failed. */
  function reportUnsaved(kind: string, state?: Unsaved) {
    unsaved.set(kind, state);
    const states = [...unsaved.values()];
    const next =
      (['saving', 'failed'] as const).find((item) => states.includes(item)) ??
      null;
    if (next === reported) return;
    reported = next;
    post('unsaved', { state: next });
  }
  const api: Record<string, unknown> = {};
  for (const [kind, plugin] of plugins) {
    const page = plugin.page?.({
      attribute: `data-humagent-${kind}`,
      annotating: annotating.api,
      notice,
      unsaved: (state) => reportUnsaved(kind, state),
      save: (review, options) => save({ ...review, kind }, options),
    });
    if (!page) continue;
    pages.set(kind, page);
    if (page.tool) annotating.register(kind, page.tool);
    for (const [name, member] of Object.entries(page.api ?? {})) {
      if (Object.hasOwn(api, name))
        throw new Error(`Duplicate page API member: ${name}`);
      api[name] = member;
    }
  }
  window.humagent = Object.freeze(api) as Window['humagent'];
  let pending: readonly SavedReview[] = [];
  /** Each plugin gets the feedback of its own kind. */
  const share = (kind: string, params: Presentation): PluginView => ({
    pending: params.pending.filter(
      (saved) => saved.review.kind === kind && saved.revision === boot.revision,
    ),
    previews: params.previews.filter((saved) => saved.review.kind === kind),
    writable: params.writable,
  });
  const handlers: {
    [M in keyof WorkspaceEvents]: (params: WorkspaceEvents[M]) => void;
  } = {
    init(params) {
      if (!initialized) {
        initialized = true;
        clearInterval(hello);
        pages.forEach((page, kind) => page.init?.(share(kind, params)));
        resolveReady();
        // The workspace ignores reports from before the page attached.
        if (reported) post('unsaved', { state: reported });
      }
      handlers.update(params);
      annotating.setMode(params.annotating);
    },
    update(params) {
      ended = !params.writable;
      pending = params.pending;
      pages.forEach((page, kind) => page.present?.(share(kind, params)));
      annotating.present(params);
    },
    annotate(params) {
      if (!ended) annotating.setMode(params.enabled, params.keyboard);
    },
    open: (params) => annotating.open(params.reviewId),
    highlight: (params) => annotating.highlight(params.reviewId),
    outside: () => annotating.outside(),
    discard({ reviewId, revision }) {
      const saved = pending.find((d) => d.review.id === reviewId);
      if (saved?.revision === revision && revision === boot.revision)
        pages.get(saved.review.kind)?.discard?.(saved);
      // Page requests stay in order, so a save sent earlier cannot recreate the pending review.
      request('remove', { reviewId, revision }).catch((error: unknown) =>
        notice(errorMessage(error)),
      );
    },
  };
  window.addEventListener('message', (event) => {
    const data = event.data as WorkspaceMessage;
    if (
      event.source !== parent ||
      event.origin !== boot.parentOrigin ||
      data?.channel !== boot.channel
    )
      return;
    if (data.method === 'result') {
      const call = calls.get(data.id);
      if (!call) return;
      calls.delete(data.id);
      if (data.error !== undefined) call.reject(new Error(data.error));
      else call.resolve(data.result);
    } else if (Object.hasOwn(handlers, data.method))
      (handlers[data.method] as (params: unknown) => void)(data.params);
  });
  const hello = setInterval(() => post('hello', {}), 1000);
  post('hello', {});
}
