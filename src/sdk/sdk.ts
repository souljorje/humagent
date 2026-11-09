import { cloneJson } from '../shared/json.js';
import { createForms } from './forms.js';
import { createPageReview } from './review.js';
import type {
  Bootstrap,
  PageEvents,
  Requests,
  WorkspaceEvents,
  WorkspaceMessage,
} from '../shared/bridge.js';
import type { Submission } from '../shared/feedback.js';

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
  function emit<M extends keyof PageEvents>(method: M, params: PageEvents[M]) {
    post(method, params);
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
  const notice = (message: string) => emit('notice', { message });
  const forms = createForms({
    saveForm: (formId, values) => request('saveForm', { formId, values }),
    submit,
    notice,
  });
  const review = createPageReview({
    boot,
    stage: (item, marker) =>
      request('stage', {
        item: cloneJson(item),
        ...(marker ? { marker } : {}),
      }),
    edit: (params) => request('edit', params),
    remove: (draftId) => request('remove', { draftId }),
    notice,
    availability: (items) => emit('availability', { items }),
    mode: (enabled) => emit('mode', { enabled }),
    editing: (dirty) => emit('editing', { dirty }),
  });
  const handlers: {
    [M in keyof WorkspaceEvents]: (params: WorkspaceEvents[M]) => void;
  } = {
    init(params) {
      ended = params.ended;
      if (!initialized) {
        initialized = true;
        clearInterval(hello);
        forms.restore(params.forms);
        resolveReady();
      }
      review.present(params);
      review.setMode(params.annotating);
    },
    update: (params) => review.present(params),
    annotate(params) {
      if (!ended) review.setMode(params.enabled, params.keyboard);
    },
    open: (params) => review.edit(params.draftId),
    highlight: (params) => review.highlight(params.draftId),
    outside: () => review.outside(),
    ended() {
      ended = true;
      review.end();
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
  const hello = setInterval(() => emit('hello', {}), 1000);
  emit('hello', {});
}
