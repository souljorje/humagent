const $ = (id) => document.getElementById(id);
const id = new URL(location.href).searchParams.get('session');
const credentialKey = `humagent:key:${id}`;
if (location.hash) {
  sessionStorage.setItem(credentialKey, location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
}
const capability = sessionStorage.getItem(credentialKey);
const storageKey = `humagent:draft:${id}`,
  outboxKey = `humagent:outbox:${id}`;
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
const draft = read(storageKey, {});
let mode = draft.mode || 'interact',
  selection = draft.selection || null;
let session = null,
  loadedRevision = null,
  bridgeReady = false,
  syncing = null,
  signature = '',
  replySeen = new Set(),
  pending = read(outboxKey, []);
$('wait-command').textContent = id
  ? `humagent wait ${id} --timeout 50 --lease 600`
  : 'Open a session with humagent open.';
$('copy-command').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('wait-command').textContent);
    $('copy-command').textContent = 'Copied';
    setTimeout(() => ($('copy-command').textContent = 'Copy command'), 2000);
  } catch {
    error('Select and copy the command manually.');
  }
};
$('message').value = draft.text || '';
$('replacement').value = draft.replacement || '';
const controlEditError =
  'Edit the control through its normal interface, or annotate it instead.';
function error(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function clearControlEditError() {
  if ($('error').textContent === controlEditError) error('');
}
function saveDraft() {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        text: $('message').value,
        replacement: $('replacement').value,
        selection,
        mode,
      }),
    );
  } catch {
    error(
      'Browser storage is full; keep this tab open until you send your draft.',
    );
  }
}
function saveOutbox() {
  try {
    localStorage.setItem(outboxKey, JSON.stringify(pending));
  } catch {
    error(
      'Browser storage is unavailable. Keep this tab open until delivery succeeds.',
    );
  }
  $('outbox').hidden = !pending.length;
  $('outbox-count').textContent =
    `${pending.length} input${pending.length === 1 ? '' : 's'} awaiting confirmation`;
}
async function api(action = '', method = 'GET', data) {
  if (!capability)
    throw new Error(
      'Open this session through the Humagent CLI to obtain its browser capability.',
    );
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
  if (!response.ok) throw new Error(`${result.error}: ${result.message}`);
  return result;
}
function post(method, params = {}, requestId) {
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
function renderTarget() {
  $('target').hidden = !selection;
  $('target-label').textContent =
    selection?.target.id || selection?.target.selector || '';
  $('quote').textContent = selection?.before || '';
  $('replacement-label').hidden = !(selection && mode === 'edit');
  $('composer-label').textContent = selection
    ? mode === 'edit'
      ? 'Explanation (optional)'
      : 'Comment on selection'
    : 'Message to your agent';
}
function setMode(next) {
  if (next !== mode) clearControlEditError();
  mode = next;
  for (const button of document.querySelectorAll('[data-mode]'))
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  $('mode-hint').textContent =
    mode === 'interact'
      ? 'Use the interface normally. Switch modes to leave contextual feedback.'
      : mode === 'annotate'
        ? 'Select words or click an element, then write a comment.'
        : 'Select text or an element, then enter the exact replacement. No source is changed here.';
  post('mode', { mode });
  renderTarget();
  saveDraft();
}
function renderConversation() {
  const items = [
    ...session.events.map((e) => ({ ...e, at: e.createdAt, role: 'human' })),
    ...session.replies.map((r) => ({ ...r, role: 'agent' })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const sig = JSON.stringify(items);
  if (sig === signature) return;
  signature = sig;
  if (!items.length) return;
  const log = $('transcript'),
    wasNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  log.replaceChildren();
  for (const item of items) {
    const article = document.createElement('article');
    article.className = `entry ${item.role}`;
    const header = document.createElement('div');
    header.className = 'entry-head';
    header.textContent = item.role === 'agent' ? 'Agent' : `You · ${item.kind}`;
    article.append(header);
    if (item.role === 'agent') {
      const p = document.createElement('p');
      p.textContent = item.text;
      article.append(p);
    } else {
      const p = item.payload;
      if (p.target) {
        const q = document.createElement('blockquote');
        q.textContent =
          p.target.anchor?.quote || p.target.text || p.target.selector;
        article.append(q);
      }
      if (item.kind === 'edit') {
        const before = document.createElement('del');
        before.textContent = p.before;
        const after = document.createElement('ins');
        after.textContent = p.after || '(delete)';
        article.append(before, after);
      } else if (item.kind === 'submission') {
        const title = document.createElement('p');
        title.textContent = p.message || p.intent;
        const values = document.createElement('pre');
        values.textContent = JSON.stringify(p.values, null, 2);
        article.append(title, values);
      } else {
        const text = document.createElement('p');
        text.textContent = p.text;
        article.append(text);
      }
      const status = document.createElement('small');
      status.textContent =
        item.status === 'queued'
          ? 'Queued · waiting for agent'
          : item.status === 'delivered'
            ? 'Received · agent working'
            : 'Completed';
      article.append(status);
    }
    log.append(article);
  }
  if (wasNearBottom) log.scrollTop = log.scrollHeight;
}
async function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    const updated = await api();
    const first = !session;
    const reconnected =
      !!session && session.surface.origin !== updated.surface.origin;
    if (reconnected) {
      bridgeReady = false;
      error('The service restarted. Refresh the interface to reconnect.');
    }
    session = updated;
    $('title').textContent = session.title;
    document.title = `${session.title} · Humagent`;
    $('presence').textContent = session.ended
      ? 'Ended'
      : session.agent === 'waiting'
        ? 'Agent listening'
        : session.agent === 'working'
          ? 'Agent working'
          : 'No agent listening';
    $('presence').dataset.state = session.agent;
    $('send').disabled = session.ended;
    $('end').disabled = session.ended;
    $('agent-help').hidden = session.ended || session.agent !== 'idle';
    if (first) {
      $('frame').src = session.surface.frameUrl;
      loadedRevision = session.revision;
      replySeen = new Set(session.replies.map((r) => r.id));
    }
    $('update').hidden =
      !reconnected && (!loadedRevision || loadedRevision === session.revision);
    for (const reply of session.replies)
      if (!replySeen.has(reply.id)) {
        post('reply', reply);
        replySeen.add(reply.id);
      }
    if (session.ended) post('ended');
    renderConversation();
  })()
    .catch((e) => {
      error(e.message);
      $('presence').textContent = 'Disconnected';
      $('send').disabled = true;
      $('connecting').hidden = true;
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}
async function transmit(event) {
  // Reuse unconfirmed input across SDK calls, form retries, and reloads.
  const delivery =
    pending.find(
      (e) =>
        e.revision === event.revision &&
        e.kind === event.kind &&
        JSON.stringify(e.payload) === JSON.stringify(event.payload),
    ) ?? event;
  if (!pending.some((e) => e.clientId === delivery.clientId)) {
    pending.push(delivery);
    saveOutbox();
  }
  const result = await api('events', 'POST', delivery);
  pending = pending.filter((e) => e.clientId !== delivery.clientId);
  saveOutbox();
  await sync();
  return result;
}
$('message').addEventListener('keydown', (event) => {
  if (
    event.key === 'Enter' &&
    (event.metaKey || event.ctrlKey) &&
    !$('send').disabled
  ) {
    event.preventDefault();
    $('composer').requestSubmit();
  }
});
$('composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('message').value.trim();
  if (!text && !(selection && mode === 'edit')) return;
  const value = {
    protocol: 1,
    clientId: crypto.randomUUID(),
    revision: selection?.revision || loadedRevision,
    kind: 'message',
    payload: { text },
  };
  if (selection && mode === 'annotate') {
    value.kind = 'annotation';
    value.payload = { target: selection.target, text };
  }
  if (selection && mode === 'edit') {
    value.kind = 'edit';
    value.payload = {
      target: selection.target,
      before: selection.before,
      after: $('replacement').value,
      explanation: text,
    };
  }
  const previous = $('message').value;
  $('send').disabled = true;
  try {
    error('');
    await transmit(value);
    if ($('message').value === previous) $('message').value = '';
    selection = null;
    $('replacement').value = '';
    renderTarget();
    saveDraft();
  } catch (e) {
    error(e.message);
  } finally {
    $('send').disabled = !!session?.ended;
  }
});
for (const name of ['message', 'replacement'])
  $(name).addEventListener('input', saveDraft);
for (const button of document.querySelectorAll('[data-mode]'))
  button.addEventListener('click', () => setMode(button.dataset.mode));
$('clear-target').onclick = () => {
  selection = null;
  renderTarget();
  saveDraft();
};
$('retry').onclick = async () => {
  try {
    const queued = [...pending];
    for (const event of queued) await transmit(event);
    error('');
  } catch (e) {
    error(e.message);
  }
};
$('discard').onclick = () => {
  if (
    confirm('Discard all unconfirmed submissions? Composer drafts are kept.')
  ) {
    pending = [];
    saveOutbox();
    error('');
  }
};
$('end').onclick = async () => {
  if (
    !confirm(
      'End this session? Unsent drafts remain in this browser; new submissions will be refused.',
    )
  )
    return;
  try {
    await api('end', 'POST', {});
    await sync();
  } catch (e) {
    error(e.message);
  }
};
let flushResolve = null;
$('refresh').onclick = async () => {
  if (!session) return;
  try {
    if (bridgeReady) {
      const flushed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          flushResolve = null;
          reject(
            new Error(
              'Interface did not confirm saved working state. Refresh was cancelled.',
            ),
          );
        }, 5000);
        flushResolve = (message) => {
          clearTimeout(timer);
          flushResolve = null;
          if (message.error) reject(new Error(message.error));
          else resolve();
        };
      });
      post('flush');
      await flushed;
    }
    await sync();
    const reloadInPlace = bridgeReady;
    bridgeReady = false;
    $('connecting').hidden = false;
    $('bridge-status').textContent = 'Bridge connecting';
    if (reloadInPlace) post('reload');
    else $('frame').src = session.surface.frameUrl;
    // Retain an existing selection with its old revision; never silently rebind it.
  } catch (e) {
    error(e.message);
  }
};
window.addEventListener('message', async (event) => {
  if (
    !session ||
    event.source !== $('frame').contentWindow ||
    event.origin !== session.surface.origin ||
    event.data?.channel !== session.surface.channel ||
    event.data?.humagent !== 1
  )
    return;
  const msg = event.data;
  if (msg.method === 'hello') {
    bridgeReady = true;
    loadedRevision = msg.revision;
    $('connecting').hidden = true;
    $('bridge-status').textContent = 'Interface connected';
    post('init', {
      mode,
      state: session.state,
      stateVersion: session.stateVersion,
      ended: session.ended,
    });
    return;
  }
  if (msg.method === 'flushed') {
    flushResolve?.(msg.params);
    return;
  }
  if (msg.method === 'notice') {
    error(String(msg.params?.message || ''));
    return;
  }
  if (msg.method === 'mode') {
    setMode(msg.params.mode);
    return;
  }
  if (msg.method === 'selected') {
    if (mode === 'edit' && !msg.params.editable) {
      error(controlEditError);
      return;
    }
    clearControlEditError();
    selection = { ...msg.params, revision: msg.revision };
    renderTarget();
    saveDraft();
    (mode === 'edit' ? $('replacement') : $('message')).focus();
    return;
  }
  if (!['submit', 'state'].includes(msg.method) || !msg.id) return;
  try {
    let result;
    if (msg.method === 'submit')
      result = await transmit({
        protocol: 1,
        clientId: msg.id,
        kind: msg.params.kind,
        revision: msg.revision,
        payload: msg.params.payload,
      });
    else {
      result = await api('state', 'PUT', msg.params);
      session.state = result.state;
      session.stateVersion = result.stateVersion;
    }
    $('frame').contentWindow.postMessage(
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
    error(e.message);
    $('frame').contentWindow.postMessage(
      {
        humagent: 1,
        channel: session.surface.channel,
        method: 'result',
        id: msg.id,
        error: e.message,
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
      if (!response.ok) throw new Error('Connection lost');
      const reader = response.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        await sync();
      }
    } catch {}
    $('presence').textContent = 'Reconnecting';
    await new Promise((r) => setTimeout(r, 2000));
  }
}
setMode(mode);
saveOutbox();
await sync();
if (session) {
  void listen();
  setInterval(sync, 3000);
  setTimeout(() => {
    if (!bridgeReady) {
      $('connecting').hidden = true;
      error(
        'The interface did not connect. Check the local server and its security policy. Your page remains visible.',
      );
    }
  }, 8000);
}
