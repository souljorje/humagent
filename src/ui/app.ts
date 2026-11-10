import { textDiff } from './text-diff.js';
import type { WorkspaceView } from '../shared/feedback.js';
import type { PageMessage, Presentation } from '../shared/bridge.js';
import { createSession } from './session.js';
import { connectPage } from './page-bridge.js';
import { icon } from '../shared/icons.js';
import { errorMessage } from '../shared/errors.js';
import { installTooltips } from '../shared/tooltips.js';
import { inputStyles } from '../shared/input-styles.js';
import { materialStyles } from '../shared/material-styles.js';

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
const server = createSession(id, update);

/** The server owns all feedback. This page renders its latest view. */
let session: WorkspaceView | undefined,
  /** The page document attached to the server, after its handshake. */
  page: { documentId: string; revision: string } | undefined,
  attaching: string | undefined,
  connected = false,
  annotating = false,
  editorDirty = false,
  sending = false,
  sent = false,
  manuallyToggled = false,
  messageTimer: ReturnType<typeof setTimeout> | undefined,
  lastPresentation = '';
const available = new Map<string, boolean>();

$('annotate').innerHTML = icon('comment');
$('end').innerHTML = icon('power');
$('expand-icon').innerHTML = icon('chevron');
$('copy-command').innerHTML = icon('copy');
$('agent-command').textContent = `humagent wait ${id}`;
installTooltips(document);
const inputStyle = new CSSStyleSheet();
inputStyle.replaceSync(materialStyles + inputStyles);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, inputStyle];

let expanded = false;
function resizeTray() {
  $('tray').style.height =
    `${expanded ? $('tray-content').getBoundingClientRect().height : 0}px`;
}
new ResizeObserver(resizeTray).observe($('tray-content'));
function openTray(open = true) {
  expanded = open;
  $('tray').inert = !open;
  $('tray').dataset.expanded = String(open);
  resizeTray();
  $('toggle-review').setAttribute('aria-expanded', String(open));
  if (!open) bridge.post('highlight', {});
}
function error(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
  if (message) openTray();
}

async function write<T extends object = object>(
  action: string,
  method: string,
  data?: unknown,
) {
  return server.write<T>(action, method, data).catch((e) => {
    void sync();
    throw e;
  });
}
async function sync() {
  try {
    await server.read();
  } catch (e) {
    if (connected || !session) error(errorMessage(e));
    connected = false;
    $('bridge-status').textContent = 'Disconnected';
    render();
  }
}
function update(view: WorkspaceView) {
  const first = !session;
  const restarted = !!session && session.surface.origin !== view.surface.origin;
  const ended = view.ended && !session?.ended;
  session = view;
  connected = true;
  if (first) {
    document.title = `${view.title} · Humagent`;
    $('frame').src = view.surface.frameUrl;
    if (!manuallyToggled && !view.ended && view.agent === 'idle') openTray();
  }
  if (restarted) {
    page = attaching = undefined;
    error('The service restarted. Refresh the page to reconnect.');
  }
  if (ended) bridge.post('ended', {});
  render();
}

function presentation(view: WorkspaceView): Presentation {
  return {
    drafts: view.drafts,
    previews: [...view.drafts, ...view.sent].filter(
      (draft) =>
        draft.item.replacement &&
        draft.revision === view.revision &&
        draft.revision === page?.revision,
    ),
    writable: !view.ended,
  };
}
function button(label: string, action: () => unknown, disabled = false) {
  const el = element('button', label);
  el.disabled = disabled;
  el.onclick = () =>
    Promise.resolve()
      .then(action)
      .catch((e) => error(errorMessage(e)));
  return el;
}
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className?: string,
) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
const rendered = new WeakMap<HTMLElement, string>();
/** Redraw only on change, and keep keyboard focus on the same draft control. */
function renderChanged(element: HTMLElement, value: unknown, draw: () => void) {
  const key = JSON.stringify(value);
  if (rendered.get(element) === key) return;
  const active = document.activeElement;
  const focusedId =
    active && element.contains(active)
      ? active.closest<HTMLElement>('[data-draft-id]')?.dataset.draftId
      : undefined;
  const label = active?.getAttribute('aria-label') ?? active?.textContent;
  element.replaceChildren();
  draw();
  rendered.set(element, key);
  if (focusedId) {
    const buttons = [
      ...(element
        .querySelector(`[data-draft-id="${CSS.escape(focusedId)}"]`)
        ?.querySelectorAll('button') || []),
    ];
    const next =
      buttons.find(
        (el) =>
          (el.getAttribute('aria-label') ?? el.textContent) === label &&
          !el.disabled,
      ) || buttons.find((el) => !el.disabled);
    next?.focus({ preventScroll: true });
  }
}
function resizeMessage() {
  $('message').style.height = 'auto';
  $('message').style.height = `${Math.min(136, $('message').scrollHeight)}px`;
}
function agentAvailable() {
  return (
    connected &&
    !session?.ended &&
    (session?.agent === 'waiting' || session?.agent === 'working')
  );
}
function render() {
  renderConnection();
  if (!session) return;
  const view = session;
  const mutable = !view.ended;
  $('end').disabled = view.ended;
  $('annotate').disabled = view.ended || !page;
  $('annotate').setAttribute('aria-pressed', String(annotating));
  $('update').hidden = !page || page.revision === view.revision;
  const count = view.drafts.length;
  $('pending-count').hidden = !count;
  $('pending-count').textContent = count ? `Drafts (${count})` : '';
  renderChanged(
    $('drafts'),
    [
      view.drafts,
      mutable,
      page?.revision,
      view.revision,
      view.drafts.map((draft) => available.get(draft.item.id)),
    ],
    () => {
      for (const [index, draft] of view.drafts.entries()) {
        const item = draft.item;
        const stale =
          draft.revision !== page?.revision || draft.revision !== view.revision;
        const li = element('li', '', 'draft');
        li.dataset.draftId = item.id;
        li.dataset.stale = String(stale);
        const content = element('div', '', 'draft-content');
        li.append(content);
        content.append(
          element(
            'div',
            String(
              draft.labels?.title ??
                (item.replacement
                  ? 'Text edit'
                  : item.intent ||
                    item.target?.id ||
                    item.target?.tag ||
                    'Comment'),
            ),
            'draft-title',
          ),
        );
        if (item.replacement) {
          const replacement = element('p', '', 'replacement');
          replacement.setAttribute('role', 'group');
          replacement.setAttribute('aria-label', 'Text changes');
          for (const part of textDiff(
            item.replacement.before,
            item.replacement.after,
          ))
            replacement.append(
              element(
                part.kind === 'remove'
                  ? 'del'
                  : part.kind === 'add'
                    ? 'ins'
                    : 'span',
                part.text,
              ),
            );
          content.append(replacement);
        }
        if (item.comment) content.append(element('p', item.comment));
        if (item.values) {
          const values = element('dl');
          // Forms send readable labels for the bar. SDK calls show raw values.
          const fields =
            draft.labels?.fields ??
            Object.entries(item.values).map(([label, value]) => ({
              label,
              value: typeof value === 'string' ? value : JSON.stringify(value),
            }));
          for (const { label, value } of fields)
            values.append(element('dt', label), element('dd', value));
          content.append(values);
        }
        const status = stale
          ? 'Stale revision. Recreate or remove this item.'
          : available.get(item.id) === false
            ? 'Target unavailable. Inspect or remove this item.'
            : '';
        if (status) content.append(element('p', status, 'draft-status'));
        if (item.target) {
          const open = button(
            '',
            () => {
              $('frame').focus();
              bridge.post('open', { draftId: item.id });
            },
            !mutable || stale || available.get(item.id) === false,
          );
          open.className = 'draft-open';
          open.setAttribute('aria-label', `Edit feedback ${index + 1}`);
          open.setAttribute('aria-haspopup', 'dialog');
          open.dataset.tooltip = status || 'Edit feedback';
          li.prepend(open);
          li.onpointerenter = () =>
            bridge.post('highlight', { draftId: item.id });
          li.onpointerleave = () => bridge.post('highlight', {});
          li.addEventListener('focusin', () =>
            bridge.post('highlight', { draftId: item.id }),
          );
          li.addEventListener('focusout', (event) => {
            if (
              !li.contains(event.relatedTarget as Node | null) &&
              !li.matches(':hover')
            )
              bridge.post('highlight', {});
          });
        }
        const remove = button(
          '',
          () =>
            draft.key !== undefined && page
              ? bridge.post('reset', { key: draft.key, draftId: item.id })
              : write(`drafts/${encodeURIComponent(item.id)}`, 'DELETE'),
          !mutable,
        );
        remove.className = 'draft-remove';
        remove.innerHTML = icon('trash');
        remove.setAttribute('aria-label', `Delete feedback ${index + 1}`);
        li.append(remove);
        $('drafts').append(li);
      }
    },
  );
  if (messageTimer === undefined && document.activeElement !== $('message'))
    $('message').value = view.message;
  $('message').disabled = !mutable;
  resizeMessage();
  $('send').textContent = sending ? 'Sending…' : sent ? 'Sent' : 'Send';
  $('send').setAttribute('aria-busy', String(sending));
  $('send').disabled =
    sending ||
    !agentAvailable() ||
    editorDirty ||
    !mutable ||
    !page ||
    page.revision !== view.revision ||
    (!view.drafts.length && !$('message').value.trim()) ||
    view.drafts.some((d) => d.revision !== view.revision);
  $('send').dataset.tooltip = agentAvailable()
    ? 'Send the review to your agent'
    : 'Connect an agent to send the review';
  const params = presentation(view);
  const signature = JSON.stringify(params);
  if (page && lastPresentation !== signature) {
    lastPresentation = signature;
    bridge.post('update', params);
  }
}
function renderConnection() {
  const state = session?.ended
    ? 'Session ended'
    : !connected
      ? 'Connection unavailable'
      : session?.agent === 'waiting'
        ? 'Agent listening'
        : session?.agent === 'working'
          ? 'Agent working'
          : 'No agent waiting';
  $('agent-state').textContent = state;
  $('agent-indicator').dataset.active = String(
    connected && !session?.ended && session?.agent !== 'idle',
  );
}

function saveMessage() {
  clearTimeout(messageTimer);
  messageTimer = undefined;
  return write('message', 'PUT', { text: $('message').value }).then(
    () => {
      $('draft-status').textContent = 'Saved.';
    },
    (e) => {
      $('draft-status').textContent = 'Not saved';
      throw e;
    },
  );
}
$('message').oninput = () => {
  sent = false;
  resizeMessage();
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    saveMessage().catch((e) => error(errorMessage(e)));
  }, 300);
  render();
};
let sentTimer: ReturnType<typeof setTimeout>;
$('send').onclick = async () => {
  if (sending) return;
  sending = true;
  sent = false;
  clearTimeout(sentTimer);
  render();
  try {
    if (messageTimer !== undefined) await saveMessage();
    if (editorDirty)
      throw new Error('Save or cancel your feedback before sending.');
    await write('send', 'POST', { revision: page?.revision });
    error();
    sent = true;
    sentTimer = setTimeout(() => {
      sent = false;
      render();
    }, 1500);
  } catch (e) {
    error(errorMessage(e));
  } finally {
    sending = false;
    render();
  }
};
$('toggle-review').onclick = () => {
  manuallyToggled = true;
  openTray($('toggle-review').getAttribute('aria-expanded') !== 'true');
};
let copyTimer: ReturnType<typeof setTimeout>;
$('copy-command').onclick = async () => {
  clearTimeout(copyTimer);
  $('copy-status').classList.add('sr-only');
  try {
    await navigator.clipboard.writeText($('agent-command').textContent || '');
    $('copy-command').innerHTML = icon('check');
    $('copy-command').dataset.copied = 'true';
    $('copy-status').textContent = 'Copied';
    copyTimer = setTimeout(() => {
      $('copy-command').innerHTML = icon('copy');
      delete $('copy-command').dataset.copied;
      $('copy-status').textContent = '';
    }, 1500);
  } catch {
    $('copy-command').innerHTML = icon('copy');
    delete $('copy-command').dataset.copied;
    const range = document.createRange();
    range.selectNodeContents($('agent-command'));
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    $('agent-command').focus();
    $('copy-status').textContent = 'Select and copy the command.';
    $('copy-status').classList.remove('sr-only');
  }
};
$('annotate').onclick = (event) => {
  $('frame').focus();
  bridge.post('annotate', {
    enabled: !annotating,
    keyboard: event.detail === 0,
  });
};
$('end').onclick = async () => {
  if (!confirm('End this session? Unsent drafts stay saved.')) return;
  try {
    await write('end', 'POST', {});
  } catch (e) {
    error(errorMessage(e));
  }
};
// While the page has unfinished input, the first outside press refocuses it instead of acting.
let blockedClick = false;
document.addEventListener(
  'pointerdown',
  (event) => {
    blockedClick = editorDirty;
    if (!blockedClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    bridge.post('outside', {});
  },
  true,
);
document.addEventListener(
  'click',
  (event) => {
    if (!blockedClick && !editorDirty) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!blockedClick) bridge.post('outside', {});
    blockedClick = false;
  },
  true,
);
document.addEventListener('keydown', (event) => {
  blockedClick = false;
  if (
    event.key === 'Escape' &&
    $('toggle-review').getAttribute('aria-expanded') === 'true'
  ) {
    manuallyToggled = true;
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

/** Attach a page document. The SDK repeats `hello` until `init` arrives, so a failed attach retries. */
async function attach(msg: PageMessage) {
  if (msg.documentId === attaching) return;
  attaching = msg.documentId;
  page = undefined;
  editorDirty = false;
  lastPresentation = '';
  available.clear();
  try {
    await write('surface', 'POST', { documentId: msg.documentId });
  } catch (e) {
    if (attaching === msg.documentId) {
      attaching = undefined;
      error(errorMessage(e));
    }
    return;
  }
  if (attaching !== msg.documentId || !session) return;
  page = { documentId: msg.documentId, revision: msg.revision };
  $('connecting').hidden = true;
  $('bridge-status').textContent = 'Interface connected';
  const params = presentation(session);
  lastPresentation = JSON.stringify(params);
  bridge.post('init', { ...params, ended: session.ended, annotating });
  render();
}
const bridge = connectPage({
  frame: $('frame'),
  surface: () => session?.surface,
  attached: (msg) => msg.documentId === page?.documentId,
  hello: (msg) => void attach(msg),
  failed: error,
  requests: {
    async stage({ item, marker, key, labels }, revision) {
      const known = session?.drafts.some((d) => d.key === key);
      const { draftId } = await write<{ draftId: string }>('drafts', 'POST', {
        item,
        revision,
        ...(marker ? { marker } : {}),
        ...(key !== undefined ? { key, labels } : {}),
      });
      // A form updates its draft while the human types. Only a new decision opens the bar.
      if (item.intent && (key === undefined || !known)) openTray();
      sent = false;
      error();
      return { draftId, status: 'draft' };
    },
    async edit({ draftId, ...changes }, revision) {
      await write(`drafts/${encodeURIComponent(draftId)}`, 'PATCH', {
        ...changes,
        revision,
      });
      return null;
    },
    async remove({ draftId }) {
      await write(`drafts/${encodeURIComponent(draftId)}`, 'DELETE');
      return null;
    },
  },
  events: {
    mode({ enabled }) {
      annotating = enabled;
      $('annotate').setAttribute('aria-pressed', String(annotating));
      if (!annotating) $('annotate').focus();
    },
    editing({ dirty }) {
      editorDirty = dirty;
      render();
    },
    notice({ message }) {
      error(message);
    },
    availability({ items }) {
      for (const item of items) available.set(item.id, item.available);
      render();
    },
  },
});
window.addEventListener('beforeunload', (event) => {
  if (messageTimer === undefined && !editorDirty) return;
  event.preventDefault();
  event.returnValue = '';
});

await sync();
setInterval(() => void sync(), 1000);
setTimeout(() => {
  if (!page) {
    $('connecting').hidden = true;
    error(
      'The page did not connect. Check its security policy or local server.',
    );
  }
}, 8000);
