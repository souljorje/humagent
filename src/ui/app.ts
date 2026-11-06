import { createReview } from './review-state.js';
import type { SessionSnapshot } from '../runtime/server.js';
import type { Event as ReviewEvent } from '../runtime/protocol.js';
import type { StageResult, StateResult } from '../shared/review.js';
import type {
  PageMessage,
  WorkspaceMessage,
  ReviewPresentation,
  RequestResult,
} from '../shared/bridge.js';
import { icon } from '../shared/icons.js';
import { fingerprint } from '../shared/batch.js';
import { errorMessage } from '../shared/errors.js';
import { createExpansion } from './expansion.js';

type Controls = Record<string, HTMLElement> & {
  frame: HTMLIFrameElement;
  message: HTMLTextAreaElement;
  send: HTMLButtonElement;
  annotate: HTMLButtonElement;
  end: HTMLButtonElement;
};
const $ = <K extends keyof Controls>(id: K): Controls[K] =>
  document.getElementById(id) as Controls[K];
const id = new URL(location.href).searchParams.get('session') ?? '';
const credentialKey = `humagent:key:${id}`;
if (location.hash) {
  sessionStorage.setItem(credentialKey, location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
}
const capability = sessionStorage.getItem(credentialKey) ?? '';
let session: SessionSnapshot,
  review!: ReturnType<typeof createReview>,
  loadedRevision: string | undefined,
  latestDocument: string | undefined,
  bridgeReady = false,
  syncing: Promise<SessionSnapshot> | null,
  writable = false,
  annotating = false,
  connected = false,
  editorDirty = false,
  flushCall: {
    id: string;
    finish(params: { error?: string; ok?: boolean }): void;
  } | null;
const available = new Map<string, boolean>();
const mutations = new Map<
  string,
  { signature: string; result: RequestResult }
>();
$('annotate').innerHTML = icon('comment');
$('end').innerHTML = icon('power');
$('expand-icon').innerHTML = icon('chevron');
$('agent-command').textContent = `humagent wait ${id} --timeout 50 --lease 600`;
const expand = createExpansion($('tray'), $('tray-content'));
const rendered = new WeakMap<HTMLElement, string>();
function renderChanged(element: HTMLElement, value: unknown, draw: () => void) {
  const key = JSON.stringify(value);
  if (rendered.get(element) === key) return;
  const active = document.activeElement;
  const focusedId =
    active && element.contains(active)
      ? active.closest<HTMLElement>('[data-draft-id],[data-batch-id]')?.dataset
      : null;
  const label = active?.textContent;
  element.replaceChildren();
  draw();
  rendered.set(element, key);
  if (focusedId) {
    const selector = focusedId.draftId
      ? `[data-draft-id="${CSS.escape(focusedId.draftId)}"]`
      : `[data-batch-id="${CSS.escape(focusedId.batchId!)}"]`;
    const buttons = [
      ...(element.querySelector(selector)?.querySelectorAll('button') || []),
    ];
    const next =
      buttons.find((el) => el.textContent === label && !el.disabled) ||
      buttons.find((el) => !el.disabled);
    next?.focus({ preventScroll: true });
  }
}
let unsavedMessage = false;
function error(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
  if (message) openTray();
}
function openTray(open = true) {
  expand(open);
  $('toggle-review').setAttribute('aria-expanded', String(open));
}
function canWrite(retry = false) {
  if (!writable)
    throw new Error(
      'This review is editable in another tab. Close that tab, then reload here.',
    );
  if (!review)
    throw new Error(
      'Browser storage is unavailable. Restore access before adding feedback.',
    );
  if (session?.ended && !retry) throw new Error('Review session has ended');
}
async function api<T = void>(
  action = '',
  method = 'GET',
  data?: unknown,
): Promise<T> {
  if (!capability)
    throw new Error('Open this session through the Humagent CLI.');
  const response = await fetch(
    `/api/sessions/${id}${action ? '/' + action : ''}`,
    {
      method,
      headers: {
        'x-humagent-session': capability,
        'content-type': 'application/json',
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    },
  );
  const result = await response.json();
  if (!response.ok) {
    const failure = Object.assign(
      new Error(`${result.error}: ${result.message}`),
      {
        rejected: response.status >= 400 && response.status < 500,
      },
    );
    throw failure;
  }
  return result;
}
function post(
  method: WorkspaceMessage['method'],
  params:
    | Extract<WorkspaceMessage, { params: unknown }>['params']
    | Record<string, never> = {},
  requestId?: string,
) {
  if (session)
    $('frame').contentWindow?.postMessage(
      {
        humagent: 1,
        channel: session.surface.channel,
        method,
        params,
        id: requestId,
      },
      session.surface.origin,
    );
}
function button(
  label: string,
  action: () => unknown,
  disabled = false,
  retry = false,
) {
  const el = document.createElement('button');
  el.textContent = label;
  el.disabled = disabled;
  el.onclick = () =>
    Promise.resolve()
      .then(() => {
        canWrite(retry);
        return action();
      })
      .catch((e) => error(errorMessage(e)));
  return el;
}
function paragraph(text: string, className?: string) {
  const el = document.createElement('p');
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
function presentation(): ReviewPresentation {
  const items = review?.snapshot().drafts || [];
  return {
    items,
    locked: items.filter((d) => review.locked(d.item.id)).map((d) => d.item.id),
    writable: writable && !session?.ended,
  };
}
function resizeMessage() {
  $('message').style.height = 'auto';
  $('message').style.height = `${Math.min(136, $('message').scrollHeight)}px`;
}
function render() {
  if (!review) return;
  const snapshot = review.snapshot();
  const count = snapshot.drafts.length;
  $('pending-count').textContent = count ? String(count) : '';
  $('toggle-review').title = count
    ? `${count} pending items`
    : 'Review details';
  $('annotate').setAttribute('aria-pressed', String(annotating));
  const mutable = writable && !session?.ended;
  renderChanged(
    $('drafts'),
    [
      snapshot.drafts,
      snapshot.outbox,
      mutable,
      loadedRevision,
      session?.revision,
      [...available],
    ],
    () => {
      for (const draft of snapshot.drafts) {
        const item = draft.item,
          locked = review.locked(item.id);
        const stale =
          draft.revision !== loadedRevision ||
          draft.revision !== session?.revision;
        const li = document.createElement('li');
        li.className = 'draft';
        li.dataset.draftId = item.id;
        li.dataset.stale = String(stale);
        const title = document.createElement('div');
        title.className = 'draft-title';
        title.textContent = String(
          item.intent || item.target?.id || item.target?.tag || 'Selected text',
        );
        li.append(title);
        if (item.target) {
          const quote = document.createElement('blockquote'),
            anchor = item.target.anchor;
          quote.textContent = String(
            (anchor && typeof anchor === 'object' && !Array.isArray(anchor)
              ? anchor.quote
              : '') ||
              item.target.text ||
              '',
          );
          li.append(quote);
        }
        if (item.replacement) {
          const before = document.createElement('del'),
            after = document.createElement('ins');
          before.textContent = item.replacement.before;
          after.textContent = item.replacement.after || '(delete)';
          li.append(before, after);
        }
        if (item.comment) li.append(paragraph(item.comment));
        if (item.values) {
          const values = document.createElement('dl');
          for (const [key, value] of Object.entries(item.values)) {
            const label = document.createElement('dt'),
              content = document.createElement('dd');
            label.textContent = key;
            content.textContent =
              typeof value === 'string' ? value : JSON.stringify(value);
            values.append(label, content);
          }
          li.append(values);
        }
        li.append(
          paragraph(
            locked
              ? 'Awaiting confirmation'
              : stale
                ? 'Stale revision. Recreate or remove this item.'
                : available.get(item.id) === false
                  ? 'Target unavailable. Inspect or remove this item.'
                  : 'Draft',
            'draft-status',
          ),
        );
        const actions = document.createElement('div');
        actions.className = 'actions';
        if (item.target)
          actions.append(
            button(
              'Edit',
              () => {
                $('frame').focus();
                post('edit', { draftId: item.id });
              },
              !mutable || locked || stale || available.get(item.id) === false,
            ),
          );
        actions.append(
          button('Remove', () => review.remove(item.id), !mutable || locked),
        );
        li.append(actions);
        $('drafts').append(li);
      }
    },
  );
  if (!unsavedMessage && document.activeElement !== $('message'))
    $('message').value = snapshot.message.text;
  $('message').disabled = !mutable;
  resizeMessage();
  $('message-stale').hidden =
    !snapshot.message.text.trim() ||
    review.messageLocked() ||
    snapshot.message.revision === loadedRevision;
  const drafts = snapshot.drafts.filter((d) => !review.locked(d.item.id));
  const hasMessage = !review.messageLocked() && !!snapshot.message.text.trim();
  $('send').disabled =
    editorDirty ||
    unsavedMessage ||
    !mutable ||
    !bridgeReady ||
    (!drafts.length && !hasMessage) ||
    drafts.some((d) => d.revision !== loadedRevision) ||
    (hasMessage && snapshot.message.revision !== loadedRevision) ||
    loadedRevision !== session?.revision;
  $('send').title = 'Send feedback to your agent';
  $('outbox').hidden = !snapshot.outbox.length;
  renderChanged($('pending-batches'), [snapshot.outbox, writable], () => {
    for (const entry of snapshot.outbox) {
      const div = document.createElement('div');
      div.className = 'pending';
      div.dataset.batchId = entry.batch.clientId;
      div.append(
        paragraph(
          `${entry.batch.payload.items.length} feedback items${entry.batch.payload.message ? ' and an instruction' : ''}`,
        ),
      );
      if (entry.error) div.append(paragraph(entry.error));
      div.append(
        button(
          'Retry send',
          () => deliver(entry.batch.clientId),
          !writable,
          true,
        ),
      );
      if (entry.rejected)
        div.append(
          button(
            'Return to drafts',
            () => review.release(entry.batch.clientId),
            !writable,
          ),
        );
      $('pending-batches').append(div);
    }
  });
  post('drafts', presentation());
}
function renderStatus() {
  const event = session.events.at(-1);
  $('activity').hidden = !event && !session.ended;
  $('activity').textContent = session.ended
    ? 'Session ended'
    : !event
      ? ''
      : event.status === 'delivered'
        ? 'Working'
        : event.status === 'completed'
          ? 'Completed'
          : 'Sent';
}
function renderConnection() {
  const state = session?.ended
    ? 'Session ended'
    : !connected
      ? 'Connection unavailable'
      : session.agent === 'waiting'
        ? 'Agent listening'
        : session.agent === 'working'
          ? 'Agent working'
          : 'No agent waiting';
  $('agent-state').textContent = state;
  $('agent-indicator').setAttribute('aria-label', state);
  $('agent-indicator').dataset.active = String(
    connected && !session?.ended && session?.agent !== 'idle',
  );
}
async function flushPage() {
  if (!bridgeReady)
    throw new Error('Wait for the page to connect before continuing.');
  if (flushCall) throw new Error('Wait for the current save to finish.');
  const requestId = crypto.randomUUID();
  const flushed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      flushCall = null;
      reject(new Error('The page did not confirm saved input. Try again.'));
    }, 20000);
    flushCall = {
      id: requestId,
      finish(params) {
        clearTimeout(timer);
        flushCall = null;
        if (params.error) reject(new Error(params.error));
        else resolve();
      },
    };
  });
  post('flush', {}, requestId);
  await flushed;
}
async function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    const documentId = latestDocument;
    const updated = await api<SessionSnapshot>();
    if (documentId && documentId !== latestDocument) return session;
    const first = !session;
    const reconnected =
      !!session && session.surface.origin !== updated.surface.origin;
    session = updated;
    connected = true;
    renderConnection();
    document.title = `${session.title} · Humagent`;
    $('end').disabled = session.ended || !writable;
    $('annotate').disabled = session.ended || !writable || !bridgeReady;
    if (first) $('frame').src = session.surface.frameUrl;
    if (reconnected) {
      bridgeReady = false;
      error('The service restarted. Refresh the page to reconnect.');
    }
    $('update').hidden =
      !reconnected && (!loadedRevision || loadedRevision === session.revision);
    if (session.ended) post('ended');
    renderStatus();
    render();
    return session;
  })()
    .catch((e) => {
      connected = false;
      renderConnection();
      error(errorMessage(e));
      $('bridge-status').textContent = 'Disconnected';
      throw e;
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}
async function deliver(clientId: string) {
  canWrite(true);
  await review.deliver(clientId, (value) =>
    api<ReviewEvent>('events', 'POST', value),
  );
  error();
  await sync();
}
$('send').onclick = async () => {
  try {
    canWrite();
    if (unsavedMessage)
      throw new Error(
        'Save the overall instruction before sending. Edit it to retry browser storage.',
      );
    await sync();
    await flushPage();
    await sync();
    if (editorDirty)
      throw new Error('Save or cancel your feedback before sending.');
    if (!bridgeReady || loadedRevision !== session.revision)
      throw new Error('Refresh and inspect stale feedback before sending.');
    const clientId = review.begin(loadedRevision);
    await deliver(clientId);
  } catch (e) {
    error(errorMessage(e));
  }
};
$('message').oninput = () => {
  try {
    canWrite();
    unsavedMessage = false;
    review.setMessage($('message').value, loadedRevision ?? null);
    $('draft-status').textContent = 'Saved in this browser.';
    resizeMessage();
  } catch (e) {
    unsavedMessage = true;
    $('send').disabled = true;
    error(`Draft could not be saved. Keep this tab open. ${errorMessage(e)}`);
    $('draft-status').textContent = 'Not saved';
  }
};
$('verify-message').onclick = () => {
  try {
    canWrite();
    review.setMessage($('message').value, loadedRevision ?? null);
  } catch (e) {
    error(errorMessage(e));
  }
};
$('toggle-review').onclick = () =>
  openTray($('toggle-review').getAttribute('aria-expanded') !== 'true');
let copyTimer: ReturnType<typeof setTimeout>;
$('copy-command').onclick = async () => {
  clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText($('agent-command').textContent || '');
    $('copy-status').textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('agent-command'));
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    $('agent-command').focus();
    $('copy-status').textContent = 'Select and copy the command.';
  }
  copyTimer = setTimeout(() => {
    $('copy-status').textContent = '';
  }, 2500);
};
$('take-over').onclick = () => location.reload();
$('annotate').onclick = (event) => {
  try {
    canWrite();
    $('frame').focus();
    post('annotate', { enabled: !annotating, keyboard: event.detail === 0 });
  } catch (e) {
    error(errorMessage(e));
  }
};
$('end').onclick = async () => {
  if (!confirm('End this session? Drafts remain in this browser.')) return;
  try {
    canWrite();
    await api('end', 'POST', {});
    await sync();
  } catch (e) {
    error(errorMessage(e));
  }
};
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    openTray(false);
    $('toggle-review').focus();
  }
  if (
    event.key === 'Enter' &&
    (event.ctrlKey || event.metaKey) &&
    !$('send').disabled
  ) {
    event.preventDefault();
    $('send').click();
  }
});
window.addEventListener('message', async (event) => {
  if (
    !session ||
    event.source !== $('frame').contentWindow ||
    event.origin !== session.surface.origin ||
    event.data?.channel !== session.surface.channel ||
    event.data?.humagent !== 1
  )
    return;
  const msg = event.data as PageMessage;
  if (msg.method === 'hello') {
    if (latestDocument !== msg.documentId) {
      editorDirty = false;
      mutations.clear();
    }
    latestDocument = msg.documentId;
    if (writable) {
      let documentId = msg.documentId;
      try {
        for (;;) {
          const activated = await api<Omit<SessionSnapshot, 'surface'>>(
            'surface',
            'POST',
            {
              documentId,
            },
          );
          if (documentId === latestDocument) {
            session = { ...session, ...activated };
            break;
          }
          documentId = latestDocument;
        }
      } catch (e) {
        if (documentId === latestDocument) error(errorMessage(e));
        return;
      }
    }
    if (msg.documentId !== latestDocument) return;
    bridgeReady = true;
    loadedRevision = msg.revision;
    available.clear();
    $('connecting').hidden = true;
    $('bridge-status').textContent = 'Interface connected';
    $('annotate').disabled = !writable || session.ended;
    post('init', {
      state: session.state,
      stateVersion: session.stateVersion,
      ended: session.ended,
      ...presentation(),
      annotating,
    });
    void sync().catch(() => {});
    return;
  }
  if (msg.documentId !== latestDocument || msg.revision !== loadedRevision)
    return;
  if (msg.method === 'flushed') {
    if (flushCall?.id === msg.id) flushCall.finish(msg.params);
    return;
  }
  if (msg.method === 'notice') {
    error(String(msg.params?.message || ''));
    return;
  }
  if (msg.method === 'mode') {
    annotating = msg.params.enabled;
    $('annotate').setAttribute('aria-pressed', String(annotating));
    if (!annotating) $('annotate').focus();
    return;
  }
  if (msg.method === 'editing') {
    editorDirty = msg.params.dirty;
    render();
    return;
  }
  if (msg.method === 'availability') {
    for (const item of msg.params.items) available.set(item.id, item.available);
    render();
    return;
  }
  if (
    (msg.method !== 'edit' &&
      msg.method !== 'remove' &&
      msg.method !== 'stage' &&
      msg.method !== 'state' &&
      msg.method !== 'readState') ||
    typeof msg.id !== 'string'
  )
    return;
  try {
    canWrite();
    let result: StageResult | StateResult | { ok: true };
    if (msg.method === 'stage') {
      if (msg.revision !== session.revision)
        throw new Error('Refresh the page before adding feedback.');
      result = review.stage(msg.params.item, msg.revision, msg.id);
      if (msg.params.item.intent) openTray();
      error();
    } else if (msg.method === 'edit' || msg.method === 'remove') {
      if (msg.revision !== session.revision)
        throw new Error('Refresh the page before changing feedback.');
      const signature = fingerprint({ method: msg.method, params: msg.params });
      const prior = mutations.get(msg.id);
      if (prior && prior.signature !== signature)
        throw new Error('Request ID was reused with different content.');
      if (prior) result = prior.result as { ok: true };
      else {
        const draft = review
          .snapshot()
          .drafts.find((d) => d.item.id === msg.params.draftId);
        if (!draft || draft.revision !== msg.revision)
          throw new Error('Feedback is unavailable for this page.');
        if (msg.method === 'remove') review.remove(draft.item.id);
        else {
          const item = draft.item;
          item.comment = msg.params.comment;
          if (msg.params.after !== undefined) {
            if (!item.replacement)
              throw new Error('This feedback is not a replacement.');
            item.replacement.after = msg.params.after;
          }
          review.edit(item.id, item);
        }
        result = { ok: true };
        mutations.set(msg.id, { signature, result });
        if (mutations.size > 200)
          mutations.delete(mutations.keys().next().value!);
      }
    } else {
      const saved =
        msg.method === 'readState'
          ? await api<StateResult>()
          : await api<StateResult>('state', 'PUT', msg.params);
      result = { state: saved.state, stateVersion: saved.stateVersion };
      session.state = result.state;
      session.stateVersion = result.stateVersion;
    }
    $('frame').contentWindow!.postMessage(
      {
        humagent: 1,
        channel: session.surface.channel,
        method: 'result',
        id: msg.id,
        result,
      },
      session.surface.origin,
    );
  } catch (e) {
    error(errorMessage(e));
    $('frame').contentWindow!.postMessage(
      {
        humagent: 1,
        channel: session.surface.channel,
        method: 'result',
        id: msg.id,
        error: errorMessage(e),
      },
      session.surface.origin,
    );
  }
});
async function listen() {
  while (true) {
    try {
      const response = await fetch(`/api/sessions/${id}/stream`, {
        headers: { 'x-humagent-session': capability },
      });
      if (!response.ok) throw new Error('Disconnected');
      const reader = response.body!.getReader();
      try {
        while (!(await reader.read()).done) await sync();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
await new Promise<void>((resolve) => {
  if (!navigator.locks) {
    error(
      'This browser cannot safely coordinate review tabs. Use a current browser.',
    );
    resolve();
    return;
  }
  void navigator.locks
    .request(`humagent:review:${id}`, { ifAvailable: true }, async (lock) => {
      writable = !!lock;
      $('readonly').hidden = writable;
      try {
        review = createReview(localStorage, id, render);
      } catch (e) {
        error(errorMessage(e));
        writable = false;
      }
      resolve();
      if (lock)
        await new Promise<void>((release) =>
          window.addEventListener('pagehide', () => release(), { once: true }),
        );
    })
    .catch((e) => {
      error(errorMessage(e));
      resolve();
    });
});
window.addEventListener('storage', (event) => {
  if (!writable && event.key === `humagent:review:${id}`) {
    try {
      review?.reload();
    } catch (e) {
      error(errorMessage(e));
    }
  }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
window.addEventListener('pagehide', () => {
  writable = false;
});
window.addEventListener('beforeunload', (event) => {
  if (!unsavedMessage && !editorDirty) return;
  event.preventDefault();
  event.returnValue = '';
});
try {
  await sync();
  if (review?.snapshot().outbox.length || !writable) openTray();
  void listen();
  setInterval(() => {
    void sync().catch(() => {});
  }, 3000);
  setTimeout(() => {
    if (!bridgeReady) {
      $('connecting').hidden = true;
      error(
        'The page did not connect. Check its security policy or local server.',
      );
    }
  }, 8000);
} catch {
  $('connecting').hidden = true;
}
