import { cloneJson } from '../shared/json.js';
import { createForms } from './forms.js';
import { createPageReview } from './review.js';
import type {
  Bootstrap,
  Requests,
  WorkspaceEvents,
  WorkspaceMessage,
} from '../shared/bridge.js';
import type { Submission } from '../shared/feedback.js';
import { errorMessage } from '../shared/errors.js';

if (window.parent === window.top) {
  if (!window.__HUMAGENT__ || window.parent === window)
    throw new Error('Humagent SDK requires an attached workspace');
  const boot: Bootstrap = window.__HUMAGENT__;
  let initialized = false,
    ended = false,
    resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const pending = new Map<
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
    if (ended) throw new Error('Review session has ended');
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      post(method, params, id);
    });
  }
  async function submit(value: Submission) {
    const captured = cloneJson(value);
    if (!captured || typeof captured !== 'object' || Array.isArray(captured))
      throw new Error('submit expects an object');
    return request('stage', {
      item: {
        intent: captured.intent,
        values: captured.values,
        ...(captured.message ? { comment: captured.message } : {}),
      },
    });
  }
  window.humagent = Object.freeze({ submit });
  const notice = (message: string) => post('notice', { message });
  const forms = createForms({
    revision: boot.revision,
    stage: (item, key, labels) =>
      request('stage', { item: cloneJson(item), key, labels }),
    notice,
  });
  const review = createPageReview({ boot, request, notice, post });
  const handlers: {
    [M in keyof WorkspaceEvents]: (params: WorkspaceEvents[M]) => void;
  } = {
    init(params) {
      if (!initialized) {
        initialized = true;
        clearInterval(hello);
        forms.restore(params.drafts);
        resolveReady();
      }
      handlers.update(params);
      review.setMode(params.annotating);
    },
    update(params) {
      ended = !params.writable;
      forms.present(params.drafts);
      review.present(params);
    },
    annotate(params) {
      if (!ended) review.setMode(params.enabled, params.keyboard);
    },
    open: (params) => review.edit(params.draftId),
    highlight: (params) => review.highlight(params.draftId),
    outside: () => review.outside(),
    reset(params) {
      // Page requests stay in order, so a save sent earlier cannot recreate the draft.
      forms.reset(params.key);
      request('remove', { draftId: params.draftId }).catch((error: unknown) =>
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
      const call = pending.get(data.id);
      if (!call) return;
      pending.delete(data.id);
      if (data.error !== undefined) call.reject(new Error(data.error));
      else call.resolve(data.result);
    } else if (Object.hasOwn(handlers, data.method))
      (handlers[data.method] as (params: unknown) => void)(data.params);
  });
  const hello = setInterval(() => post('hello', {}), 1000);
  post('hello', {});
}
