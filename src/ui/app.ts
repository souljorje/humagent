import { createReview } from './review-state.js';
import type { SessionSnapshot } from '../runtime/server.js';
import type { Event as ReviewEvent } from '../runtime/protocol.js';
import type { Draft, StageResult, StateResult } from '../shared/review.js';
import type { PageMessage, WorkspaceMessage } from '../shared/bridge.js';
import { errorMessage } from '../shared/errors.js';

type Controls = Record<string, HTMLElement> & {
  frame: HTMLIFrameElement;
  message: HTMLTextAreaElement;
  'edit-form': HTMLFormElement;
  'edit-comment': HTMLTextAreaElement;
  'edit-after': HTMLTextAreaElement;
  'edit-values': HTMLTextAreaElement;
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
  editing: string,
  flushCall: {
    id: string;
    finish(params: { error?: string; ok?: boolean }): void;
  } | null;
const available = new Map<string, boolean>();
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
}
function openTray(open = true) {
  $('tray').hidden = !open;
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
function render() {
  if (!review) return;
  const snapshot = review.snapshot();
  $('toggle-review').textContent = `Review (${snapshot.drafts.length})`;
  $('empty').hidden = !!snapshot.drafts.length;
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
      for (const [index, draft] of snapshot.drafts.entries()) {
        const item = draft.item;
        const li = document.createElement('li');
        li.className = 'draft';
        li.dataset.draftId = item.id;
        const stale =
          draft.revision !== loadedRevision ||
          draft.revision !== session?.revision;
        const locked = review.locked(item.id);
        li.dataset.stale = String(stale);
        const title = document.createElement('div');
        title.className = 'draft-title';
        title.textContent = String(
          item.intent || item.target?.id || item.target?.tag || 'Selected text',
        );
        li.append(title);
        if (item.target) {
          const quote = document.createElement('blockquote');
          const anchor = item.target.anchor;
          const captured =
            anchor && typeof anchor === 'object' && !Array.isArray(anchor)
              ? anchor.quote
              : undefined;
          quote.textContent = String(
            captured || item.target.text || item.target.selector || '',
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
          const values = document.createElement('pre');
          values.textContent = JSON.stringify(item.values, null, 2);
          li.append(values);
        }
        li.append(
          paragraph(
            locked
              ? 'Awaiting confirmation'
              : stale
                ? 'Stale revision — recreate or remove this item'
                : available.get(item.id) === false
                  ? 'Target unavailable — inspect before sending'
                  : 'Draft',
            'draft-status',
          ),
        );
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.append(
          button('Edit', () => edit(draft), !mutable || locked),
          button('Remove', () => review.remove(item.id), !mutable || locked),
          button(
            'Move up',
            () => review.move(item.id, -1),
            !mutable || locked || index === 0,
          ),
          button(
            'Move down',
            () => review.move(item.id, 1),
            !mutable || locked || index === snapshot.drafts.length - 1,
          ),
        );
        li.append(actions);
        $('drafts').append(li);
      }
    },
  );
  if (!unsavedMessage && document.activeElement !== $('message'))
    $('message').value = snapshot.message.text;
  $('message').disabled = !mutable;
  $('message-stale').hidden =
    !snapshot.message.text.trim() ||
    review.messageLocked() ||
    snapshot.message.revision === loadedRevision;
  const drafts = snapshot.drafts.filter((d) => !review.locked(d.item.id));
  const hasMessage = !review.messageLocked() && !!snapshot.message.text.trim();
  $('send').textContent = `Send all (${drafts.length})`;
  $('send').disabled =
    unsavedMessage ||
    !mutable ||
    !bridgeReady ||
    (!drafts.length && !hasMessage) ||
    drafts.some((d) => d.revision !== loadedRevision) ||
    (hasMessage && snapshot.message.revision !== loadedRevision) ||
    loadedRevision !== session?.revision;
  $('outbox').hidden = !snapshot.outbox.length;
  renderChanged($('pending-batches'), [snapshot.outbox, writable], () => {
    for (const entry of snapshot.outbox) {
      const div = document.createElement('div');
      div.className = 'pending';
      div.dataset.batchId = entry.batch.clientId;
      div.append(
        paragraph(
          `${entry.batch.payload.items.length} feedback items${entry.batch.payload.message ? ' and an overall instruction' : ''}`,
        ),
      );
      if (entry.error) div.append(paragraph(entry.error, 'warning'));
      div.append(
        button(
          'Retry batch',
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
  $('recovery').textContent = snapshot.recovery.join(' ');
  $('recovery').hidden = !snapshot.recovery.length;
  post('drafts', { items: snapshot.drafts });
}
function edit(draft: Draft) {
  editing = draft.item.id;
  $('edit-form').hidden = false;
  $('edit-comment').value = draft.item.comment || '';
  $('edit-original').hidden = !draft.item.replacement;
  $('edit-replacement').hidden = !draft.item.replacement;
  $('edit-original').textContent = draft.item.replacement?.before || '';
  $('edit-after').value = draft.item.replacement?.after || '';
  $('edit-structured').hidden = !draft.item.values;
  $('edit-values').value = draft.item.values
    ? JSON.stringify(draft.item.values, null, 2)
    : '';
  $('edit-comment').focus();
}
$('edit-form').onsubmit = (event) => {
  event.preventDefault();
  try {
    canWrite();
    const item = review
      .snapshot()
      .drafts.find((d) => d.item.id === editing)?.item;
    if (!item) throw new Error('Draft no longer exists');
    item.comment = $('edit-comment').value;
    if (item.replacement) item.replacement.after = $('edit-after').value;
    if (item.values) item.values = JSON.parse($('edit-values').value);
    review.edit(editing, item);
    $('edit-form').hidden = true;
    error();
  } catch (e) {
    error(errorMessage(e));
  }
};
$('cancel-edit').onclick = () => {
  $('edit-form').hidden = true;
};
function renderHistory() {
  const entries = [
    ...session.events.map((e) => ({ ...e, at: e.createdAt })),
    ...session.replies,
  ].sort((a, b) => a.at.localeCompare(b.at));
  renderChanged($('transcript'), entries, () => {
    for (const entry of entries) {
      const article = document.createElement('article');
      article.className = 'entry';
      if ('text' in entry) article.append(paragraph(entry.text));
      else {
        article.append(
          paragraph(
            `${entry.status === 'delivered' ? 'Working' : entry.status === 'completed' ? 'Completed' : 'Queued'} · ${entry.payload.items.length} feedback items`,
          ),
        );
        if (entry.payload.message)
          article.append(paragraph(entry.payload.message));
        const details = document.createElement('details'),
          summary = document.createElement('summary'),
          pre = document.createElement('pre');
        summary.textContent = 'Feedback details';
        pre.textContent = JSON.stringify(entry.payload.items, null, 2);
        details.append(summary, pre);
        article.append(details);
      }
      $('transcript').append(article);
    }
  });
  const reply = session.replies.at(-1);
  const last = session.events.at(-1);
  $('activity').hidden = !reply && !last;
  $('activity').textContent =
    reply && (!last || reply.at >= last.createdAt)
      ? `Agent: ${reply.text}`
      : last
        ? last.status === 'delivered'
          ? 'Agent is working on your review.'
          : last.status === 'completed'
            ? 'Review completed.'
            : 'Review queued. Waiting for your agent.'
        : '';
}
async function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    const updated = await api<SessionSnapshot>();
    const first = !session;
    const reconnected =
      !!session && session.surface.origin !== updated.surface.origin;
    session = updated;
    $('title').textContent = session.title;
    document.title = `${session.title} · Humagent`;
    $('presence').textContent = session.ended
      ? 'Ended'
      : session.agent === 'working'
        ? 'Agent working'
        : session.agent === 'waiting'
          ? 'Agent listening'
          : 'Agent idle';
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
    renderHistory();
    render();
    return session;
  })()
    .catch((e) => {
      error(errorMessage(e));
      $('presence').textContent = 'Disconnected';
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
$('toggle-review').onclick = () => openTray($('tray').hidden);
$('close-tray').onclick = () => {
  openTray(false);
  $('toggle-review').focus();
};
$('annotate').onclick = () => {
  try {
    canWrite();
    $('frame').focus();
    post('pick');
  } catch (e) {
    error(errorMessage(e));
  }
};
$('refresh').onclick = async () => {
  try {
    if (bridgeReady) {
      const requestId = crypto.randomUUID();
      const flushed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          flushCall = null;
          reject(
            new Error(
              'The page did not confirm saved form values. Refresh was cancelled.',
            ),
          );
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
    await sync();
    const reloadInPlace = bridgeReady;
    bridgeReady = false;
    $('connecting').hidden = false;
    $('bridge-status').textContent = 'Bridge connecting';
    if (reloadInPlace) post('reload');
    else $('frame').src = session.surface.frameUrl;
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
$('wait-command').textContent = `humagent wait ${id} --timeout 50 --lease 600`;
$('copy-command').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('wait-command').textContent || '');
    $('copy-command').textContent = 'Copied';
  } catch {
    error('Select and copy the command manually.');
  }
};
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(review?.exportRecovery(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = 'humagent-review.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('take-over').onclick = () => location.reload();
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    $('edit-form').hidden = true;
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
    latestDocument = msg.documentId;
    if (writable) {
      let documentId = msg.documentId;
      try {
        for (;;) {
          await api('surface', 'POST', { documentId });
          if (documentId === latestDocument) break;
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
      drafts: review?.snapshot().drafts || [],
    });
    void sync().catch(() => {});
    return;
  }
  if (msg.method === 'flushed') {
    if (flushCall?.id === msg.id) flushCall.finish(msg.params);
    return;
  }
  if (msg.method === 'notice') {
    error(String(msg.params?.message || ''));
    return;
  }
  if (msg.method === 'pickerDone') {
    $('annotate').focus();
    return;
  }
  if (msg.method === 'availability') {
    for (const item of msg.params.items) available.set(item.id, item.available);
    render();
    return;
  }
  if (
    (msg.method !== 'stage' &&
      msg.method !== 'state' &&
      msg.method !== 'readState') ||
    typeof msg.id !== 'string'
  )
    return;
  try {
    canWrite();
    let result: StageResult | StateResult;
    if (msg.method === 'stage') {
      result = review.stage(msg.params.item, msg.revision, msg.id);
      openTray();
      error();
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
try {
  await sync();
  if (
    review?.snapshot().drafts.length ||
    review?.snapshot().outbox.length ||
    review?.snapshot().message.text
  )
    openTray();
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
