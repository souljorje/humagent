import { batch, fingerprint, MAX_ITEMS } from '../shared/batch.js';
import { cloneJson } from '../shared/json.js';

/** One persisted record commits drafts and the immutable outbox together. */
export function createReview(storage, sessionId, changed = () => {}) {
  const key = `humagent:review:${sessionId}`;
  const empty = () => ({
    format: 2,
    drafts: [],
    message: { text: '', revision: null, token: '' },
    outbox: [],
    staged: {},
    recovery: [],
  });
  let state;
  const flights = new Map();
  const read = (name) => {
    const raw = storage.getItem(name);
    return raw === null ? null : JSON.parse(raw);
  };
  function load() {
    const saved = read(key);
    if (saved !== null) {
      if (
        saved.format !== 2 ||
        !Array.isArray(saved.drafts) ||
        !Array.isArray(saved.outbox) ||
        !saved.message ||
        !saved.staged ||
        !Array.isArray(saved.recovery)
      )
        throw new Error(
          'Saved review is unreadable. Export browser storage before recovery.',
        );
      state = saved;
      return;
    }
    const next = empty();
    if (
      storage.getItem(`humagent:outbox:${sessionId}`) ||
      storage.getItem(`humagent:draft:${sessionId}`)
    )
      next.recovery.push(
        'This session contains unsupported browser feedback. Export it for reference, then start a new session.',
      );
    storage.setItem(key, JSON.stringify(next));
    state = next;
  }
  load();
  function commit(update) {
    const next = structuredClone(state);
    update(next);
    storage.setItem(key, JSON.stringify(next));
    state = next;
    changed();
  }
  const locked = (id) =>
    state.outbox.some((entry) => entry.draftIds.includes(id));
  const messageLocked = () =>
    state.outbox.some(
      (entry) =>
        entry.messageToken && entry.messageToken === state.message.token,
    );
  function mutable(id) {
    if (locked(id))
      throw new Error(
        'This item belongs to an unconfirmed batch. Retry that batch first.',
      );
    if (!state.drafts.some((draft) => draft.item.id === id))
      throw new Error('Draft no longer exists');
  }
  function stage(item, revision, requestId = crypto.randomUUID()) {
    const captured = cloneJson(item);
    const signature = fingerprint({ item: captured, revision });
    const previous = state.staged[requestId];
    if (previous) {
      if (previous.signature !== signature)
        throw new Error('Staging request ID was reused with different content');
      return { draftId: previous.id, status: 'draft' };
    }
    if (state.drafts.filter((d) => !locked(d.item.id)).length >= MAX_ITEMS)
      throw new Error(
        'Send or remove current feedback before adding more than 100 items.',
      );
    const id = crypto.randomUUID();
    const value = batch({
      protocol: 2,
      clientId: requestId,
      revision,
      payload: { items: [{ ...captured, id }] },
    });
    commit((next) => {
      next.drafts.push({ item: value.payload.items[0], revision });
      next.staged[requestId] = { id, signature };
    });
    return { draftId: id, status: 'draft' };
  }
  function begin(revision) {
    const drafts = state.drafts.filter((d) => !locked(d.item.id));
    const message = messageLocked() ? null : state.message;
    const stale = drafts.filter((d) => d.revision !== revision);
    if (stale.length || (message?.text.trim() && message.revision !== revision))
      throw new Error(
        'Some feedback belongs to another revision. Inspect the page and recreate or remove stale items.',
      );
    const value = batch({
      protocol: 2,
      clientId: crypto.randomUUID(),
      revision,
      payload: {
        items: drafts.map((d) => d.item),
        ...(message?.text.trim() ? { message: message.text } : {}),
      },
    });
    const entry = {
      batch: value,
      draftIds: drafts.map((d) => d.item.id),
      messageToken: message?.text.trim() ? message.token : '',
    };
    commit((next) => next.outbox.push(entry));
    return value.clientId;
  }
  async function deliver(clientId, send) {
    if (flights.has(clientId)) return flights.get(clientId);
    const operation = (async () => {
      const entry = state.outbox.find((e) => e.batch.clientId === clientId);
      if (!entry) return;
      const uncertain = !!entry.uncertain;
      commit((next) => {
        const pending = next.outbox.find((e) => e.batch.clientId === clientId);
        pending.uncertain = true;
        pending.rejected = false;
      });
      let result;
      try {
        result = await send(cloneJson(entry.batch));
      } catch (error) {
        commit((next) => {
          const pending = next.outbox.find(
            (e) => e.batch.clientId === clientId,
          );
          pending.error = error.message;
          pending.rejected = !!error.rejected && !uncertain;
          pending.uncertain = uncertain || !error.rejected;
        });
        throw error;
      }
      if (result.clientId !== clientId || !result.id)
        throw new Error(
          'Storage confirmation did not match the submitted batch. Retry safely.',
        );
      commit((next) => {
        next.outbox = next.outbox.filter((e) => e.batch.clientId !== clientId);
        next.drafts = next.drafts.filter(
          (d) => !entry.draftIds.includes(d.item.id),
        );
        if (entry.messageToken && next.message.token === entry.messageToken)
          next.message = { text: '', revision: null, token: '' };
      });
      return result;
    })();
    flights.set(clientId, operation);
    try {
      return await operation;
    } finally {
      flights.delete(clientId);
    }
  }
  return {
    snapshot: () => structuredClone(state),
    reload() {
      load();
      changed();
    },
    locked,
    messageLocked,
    stage,
    begin,
    deliver,
    setMessage(text, revision) {
      commit((next) => {
        next.message = { text, revision, token: crypto.randomUUID() };
      });
    },
    edit(id, item) {
      mutable(id);
      const draft = state.drafts.find((d) => d.item.id === id);
      const value = batch({
        protocol: 2,
        clientId: 'edit',
        revision: draft.revision,
        payload: { items: [{ ...cloneJson(item), id }] },
      });
      commit((next) => {
        next.drafts.find((d) => d.item.id === id).item = value.payload.items[0];
      });
    },
    remove(id) {
      mutable(id);
      commit((next) => {
        next.drafts = next.drafts.filter((d) => d.item.id !== id);
      });
    },
    move(id, offset) {
      mutable(id);
      commit((next) => {
        const index = next.drafts.findIndex((d) => d.item.id === id);
        const position = Math.max(
          0,
          Math.min(next.drafts.length - 1, index + offset),
        );
        const [draft] = next.drafts.splice(index, 1);
        next.drafts.splice(position, 0, draft);
      });
    },
    release(clientId) {
      const entry = state.outbox.find((e) => e.batch.clientId === clientId);
      if (!entry?.rejected || entry.uncertain || flights.has(clientId))
        throw new Error('Retry unconfirmed input before changing it.');
      if (
        entry.messageToken &&
        state.message.token !== entry.messageToken &&
        state.message.text.trim()
      )
        throw new Error(
          'Save or clear the newer overall instruction before returning this batch to drafts.',
        );
      commit((next) => {
        if (entry.messageToken)
          next.message = {
            text: entry.batch.payload.message,
            revision: entry.batch.revision,
            token: entry.messageToken,
          };
        next.outbox = next.outbox.filter((e) => e.batch.clientId !== clientId);
      });
    },
    exportRecovery: () => ({
      review: state,
      draft: storage.getItem(`humagent:draft:${sessionId}`),
      outbox: storage.getItem(`humagent:outbox:${sessionId}`),
    }),
  };
}
