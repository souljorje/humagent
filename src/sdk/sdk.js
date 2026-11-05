import { cloneJson } from '../shared/json.js';
import { fingerprint } from '../shared/batch.js';
import { createForms } from './forms.js';
import { createPageReview } from './review.js';

if (window.parent === window.top) {
  const boot = window.__HUMAGENT__;
  if (!boot || window.parent === window)
    throw new Error('Humagent SDK requires an attached workspace');
  let state = {},
    stateVersion = 0,
    initialized = false,
    ended = false,
    resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const pending = new Map(),
    stages = new Map();
  let serial = Promise.resolve();
  function send(method, params = {}, id) {
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
  function request(method, params, id = crypto.randomUUID()) {
    if (ended) return Promise.reject(new Error('Review session has ended'));
    if (pending.has(id)) return pending.get(id).promise;
    let resolve, reject;
    const promise = new Promise((yes, no) => {
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
            'Workspace did not confirm this request. Check the review tray, then retry.',
          ),
        );
      }
    }, 5000);
    pending.set(id, { resolve, reject, timer, promise });
    send(method, params, id);
    return promise;
  }
  function notice(message) {
    send('notice', { message });
  }
  function updateState(update) {
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
  async function stage(item) {
    const captured = cloneJson(item);
    await ready;
    const key = fingerprint(captured);
    const id = stages.get(key) ?? crypto.randomUUID();
    stages.set(key, id);
    const result = await request('stage', { item: captured }, id);
    stages.delete(key);
    return result;
  }
  async function submit(value) {
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
    done: () => send('pickerDone'),
  });

  window.addEventListener('message', async (event) => {
    const data = event.data;
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
      if (data.error) call.reject(new Error(data.error));
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
      review.setDrafts(data.params.drafts || []);
    }
    if (data.method === 'drafts') review.setDrafts(data.params.items || []);
    if (data.method === 'pick' && !ended) review.pick();
    if (data.method === 'ended') {
      ended = true;
      review.cancel();
    }
    if (data.method === 'flush') {
      try {
        review.flush();
        await forms.flush();
        await serial.catch(() => {});
        send('flushed', { ok: true }, data.id);
      } catch (error) {
        send('flushed', { error: error.message }, data.id);
      }
    }
    if (data.method === 'reload') location.reload();
  });
  const hello = setInterval(() => send('hello'), 1000);
  send('hello');
}
