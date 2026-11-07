import { batch, fingerprint, MAX_ITEMS } from '../shared/batch.js';
import { cloneJson } from '../shared/json.js';
import type { Input, ReviewItem } from '../shared/batch.js';
import type {
  ReviewState,
  PendingBatch,
  StageResult,
  MarkerPosition,
} from '../shared/review.js';
import { errorMessage } from '../shared/errors.js';

/** One persisted record commits drafts and the immutable outbox together. */
export function createReview(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  sessionId: string,
  changed: () => void = () => {},
) {
  const key = `humagent:review:${sessionId}`;
  const empty = (): ReviewState => ({
    format: 2,
    drafts: [],
    message: { text: '', revision: null, token: '' },
    outbox: [],
    staged: {},
  });
  let state: ReviewState;
  type Confirmation = { clientId: string; id: string };
  const flights = new Map<string, Promise<Confirmation | undefined>>();
  const read = (name: string): ReviewState | null => {
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
        !saved.staged
      )
        throw new Error('Saved review is unreadable.');
      state = saved;
      return;
    }
    const next = empty();
    storage.setItem(key, JSON.stringify(next));
    state = next;
  }
  load();
  function commit(update: (next: ReviewState) => void) {
    const next = structuredClone(state);
    update(next);
    storage.setItem(key, JSON.stringify(next));
    state = next;
    changed();
  }
  const locked = (id: string) =>
    state.outbox.some((entry) => entry.draftIds.includes(id));
  const messageLocked = () =>
    state.outbox.some(
      (entry) =>
        entry.messageToken && entry.messageToken === state.message.token,
    );
  function mutable(id: string) {
    if (locked(id))
      throw new Error(
        'This item belongs to an unconfirmed batch. Retry that batch first.',
      );
    if (!state.drafts.some((draft) => draft.item.id === id))
      throw new Error('Draft no longer exists');
  }
  function copyMarker(marker?: MarkerPosition) {
    if (marker === undefined) return undefined;
    if (
      !marker ||
      !Number.isFinite(marker.x) ||
      !Number.isFinite(marker.y) ||
      (marker.textOffset !== undefined &&
        (!Number.isInteger(marker.textOffset) ||
          marker.textOffset < 0 ||
          marker.textOffset > 50000))
    )
      throw new Error('Invalid marker position');
    return {
      x: marker.x,
      y: marker.y,
      ...(marker.textOffset !== undefined
        ? { textOffset: marker.textOffset }
        : {}),
    };
  }
  function stage(
    item: unknown,
    revision: string,
    requestId: string = crypto.randomUUID(),
    marker?: MarkerPosition,
  ): StageResult {
    const captured = cloneJson(item);
    const position = copyMarker(marker);
    const signature = fingerprint({
      item: captured,
      revision,
      ...(position ? { marker: position } : {}),
    });
    const previous = state.staged[requestId];
    if (previous) {
      if (previous.signature !== signature)
        throw new Error('Staging request ID was reused with different content');
      return { draftId: previous.id, status: 'draft' };
    }
    if (Object.keys(state.staged).length >= 200)
      throw new Error(
        'Too many unconfirmed page requests. Preserve this review and open a new session.',
      );
    if (state.drafts.filter((d) => !locked(d.item.id)).length >= MAX_ITEMS)
      throw new Error(
        'Send or remove current feedback before adding more than 100 items.',
      );
    const id = crypto.randomUUID();
    const value = batch({
      protocol: 2,
      clientId: requestId,
      revision,
      payload: { items: [{ ...(captured as Record<string, unknown>), id }] },
    });
    commit((next) => {
      next.drafts.push({
        item: value.payload.items[0]!,
        revision,
        ...(position ? { marker: position } : {}),
      });
      next.staged[requestId] = { id, signature };
    });
    return { draftId: id, status: 'draft' };
  }
  function begin(revision: string) {
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
    const entry: PendingBatch = {
      batch: value,
      draftIds: drafts.map((d) => d.item.id),
      messageToken: message?.text.trim() ? message.token : '',
    };
    commit((next) => next.outbox.push(entry));
    return value.clientId;
  }
  async function deliver(
    clientId: string,
    send: (batch: Input) => Promise<Confirmation>,
  ) {
    if (flights.has(clientId)) return flights.get(clientId);
    const operation = (async () => {
      const entry = state.outbox.find((e) => e.batch.clientId === clientId);
      if (!entry) return;
      commit((next) => {
        const pending = next.outbox.find((e) => e.batch.clientId === clientId)!;
        pending.uncertain = true;
        pending.rejected = false;
      });
      let result;
      try {
        result = await send(cloneJson(entry.batch));
      } catch (error) {
        const rejected =
          error instanceof Error &&
          'rejected' in error &&
          error.rejected === true;
        commit((next) => {
          const pending = next.outbox.find(
            (e) => e.batch.clientId === clientId,
          )!;
          pending.error = errorMessage(error);
          pending.rejected = rejected;
          pending.uncertain = !rejected;
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
    confirmStage(requestId: string) {
      if (Object.hasOwn(state.staged, requestId))
        commit((next) => {
          delete next.staged[requestId];
        });
    },
    begin,
    deliver,
    setMessage(text: string, revision: string | null) {
      commit((next) => {
        next.message = { text, revision, token: crypto.randomUUID() };
      });
    },
    edit(id: string, item: ReviewItem, marker?: MarkerPosition) {
      mutable(id);
      const position = copyMarker(marker);
      const draft = state.drafts.find((d) => d.item.id === id)!;
      const value = batch({
        protocol: 2,
        clientId: 'edit',
        revision: draft.revision,
        payload: { items: [{ ...cloneJson(item), id }] },
      });
      commit((next) => {
        const updated = next.drafts.find((d) => d.item.id === id)!;
        updated.item = value.payload.items[0]!;
        if (position) updated.marker = position;
      });
    },
    remove(id: string) {
      mutable(id);
      commit((next) => {
        next.drafts = next.drafts.filter((d) => d.item.id !== id);
      });
    },
    release(clientId: string) {
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
            text: entry.batch.payload.message!,
            revision: entry.batch.revision,
            token: entry.messageToken,
          };
        next.outbox = next.outbox.filter((e) => e.batch.clientId !== clientId);
      });
    },
  };
}
