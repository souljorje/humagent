import { cloneJson } from '../shared/json.js';
import { fingerprint } from '../shared/batch.js';
import { createForms } from './forms.js';
import { createPageReview } from './review.js';
import type {
  Bootstrap,
  PageMessage,
  Requests,
  RequestResult,
  WorkspaceMessage,
} from '../shared/bridge.js';
import type { FormState, Submission } from '../shared/review.js';
import type { DraftItem } from '../shared/batch.js';
import { errorMessage } from '../shared/errors.js';

if (window.parent === window.top) {
  if (!window.__HUMAGENT__ || window.parent === window)
    throw new Error('Humagent SDK requires an attached workspace');
  const boot: Bootstrap = window.__HUMAGENT__;
  let state: FormState = {};
  let stateVersion = 0,
    initialized = false,
    ended = false,
    resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const pending = new Map<
    string,
    {
      resolve(value: RequestResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setInterval>;
      promise: Promise<RequestResult>;
    }
  >();
  const stages = new Map<string, string>();
  let serial = Promise.resolve();
  function send(
    method: PageMessage['method'],
    params: PageMessage['params'] = {},
    id?: string,
  ) {
    parent.postMessage(
      {
        humagent: 1,
        channel: boot.channel,
        method,
        params,
        id,
        revision: boot.revision,
        sourceUrl: boot.sourceUrl,
        documentId: boot.documentId,
      },
      boot.parentOrigin,
    );
  }
  function request<M extends keyof Requests>(
    method: M,
    params: Requests[M]['params'],
    id: string = crypto.randomUUID(),
  ): Promise<Requests[M]['result']> {
    if (ended) return Promise.reject(new Error('Review session has ended'));
    if (pending.has(id))
      return pending.get(id)!.promise as Promise<Requests[M]['result']>;
    let resolve!: (value: Requests[M]['result']) => void,
      reject!: (error: Error) => void;
    const promise = new Promise<Requests[M]['result']>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    let attempts = 0;
    const timer = setInterval(() => {
      if (++attempts < 3) send(method, params, id);
      else {
        clearInterval(timer);
        pending.delete(id);
        reject(
          new Error(
            'Workspace did not confirm this request. Check pending items, then retry.',
          ),
        );
      }
    }, 5000);
    pending.set(id, {
      resolve: (result) => resolve(result as Requests[M]['result']),
      reject,
      timer,
      promise,
    });
    send(method, params, id);
    return promise;
  }
  function notice(message: string) {
    send('notice', { message });
  }
  function updateState(update: (state: FormState) => FormState) {
    const operation = serial
      .catch(() => {})
      .then(async () => {
        await ready;
        const current = await request('readState', {});
        state = current.state;
        stateVersion = current.stateVersion;
        const result = await request('state', {
          state: cloneJson(update(state)),
          expectedVersion: stateVersion,
        });
        state = result.state;
        stateVersion = result.stateVersion;
      });
    serial = operation;
    return operation;
  }
  async function stage(item: DraftItem) {
    const captured = cloneJson(item);
    await ready;
    const key = fingerprint(captured);
    const id = stages.get(key) ?? crypto.randomUUID();
    stages.set(key, id);
    const result = await request('stage', { item: captured }, id);
    stages.delete(key);
    return result;
  }
  async function submit(value: Submission) {
    const captured = cloneJson(value);
    if (!captured || typeof captured !== 'object' || Array.isArray(captured))
      throw new Error('submit expects an object');
    return stage({
      intent: captured.intent,
      values: captured.values,
      ...(captured.message !== undefined ? { comment: captured.message } : {}),
    });
  }
  window.humagent = Object.freeze({ submit });
  const forms = createForms({
    getState: () => state,
    updateState,
    submit,
    notice,
  });
  const review = createPageReview({
    boot,
    stage,
    notice,
    availability: (items) => send('availability', { items }),
    edit: (params) => request('edit', params),
    remove: (draftId) => request('remove', { draftId }),
    mode: (enabled) => send('mode', { enabled }),
    editing: (dirty) => send('editing', { dirty }),
  });

  window.addEventListener('message', async (event) => {
    const data = event.data as WorkspaceMessage;
    if (
      event.source !== parent ||
      event.origin !== boot.parentOrigin ||
      data?.humagent !== 1 ||
      data.channel !== boot.channel
    )
      return;
    if (data.method === 'result') {
      const call = pending.get(data.id);
      if (!call) return;
      pending.delete(data.id);
      clearInterval(call.timer);
      if (data.error !== undefined) call.reject(new Error(data.error));
      else call.resolve(data.result);
      return;
    }
    if (data.method === 'init') {
      ended = !!data.params.ended;
      if (!initialized) {
        state = data.params.state || {};
        stateVersion = data.params.stateVersion || 0;
        initialized = true;
        clearInterval(hello);
        forms.restore();
        resolveReady();
      }
      review.setDrafts(data.params);
      review.setMode(data.params.annotating);
    }
    if (data.method === 'drafts') review.setDrafts(data.params);
    if (data.method === 'annotate' && !ended)
      review.setMode(data.params.enabled, data.params.keyboard);
    if (data.method === 'edit') review.edit(data.params.draftId);
    if (data.method === 'ended') {
      ended = true;
      review.end();
    }
    if (data.method === 'flush') {
      try {
        review.flush();
        await forms.flush();
        await serial.catch(() => {});
        send('flushed', { ok: true }, data.id);
      } catch (error) {
        send('flushed', { error: errorMessage(error) }, data.id);
      }
    }
    if (data.method === 'reload') location.reload();
  });
  const hello = setInterval(() => send('hello'), 1000);
  send('hello');
}
