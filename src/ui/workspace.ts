/** Workspace logic: session state, page attachment, and the feedback flow. It builds no markup. */
import type { SavedReview, WorkspaceView } from '../shared/feedback.js';
import type { PageMessage, Presentation } from '../shared/bridge.js';
import type { Plugin } from '../shared/plugin.js';
import { prepareEdit, prepareSave } from './reviews.js';
import { createSession } from './session.js';
import { connectPage } from './page-bridge.js';
import { errorMessage } from '../shared/errors.js';
import { createBar } from './bar.js';

export type AgentStatus =
  'ended' | 'offline' | 'connected' | 'sent' | 'working' | 'idle';
export interface SavedReviewModel {
  saved: SavedReview;
  /** The pending review belongs to another page revision. */
  stale: boolean;
  /** The page cannot find the pending review's target. */
  unavailable: boolean;
}
/** Everything the bar shows. */
export interface BarModel {
  status: AgentStatus;
  /** An agent can receive feedback. */
  agent: boolean;
  session?: WorkspaceView;
  /** A page document is attached. */
  attached: boolean;
  /** The source changed after the page loaded. */
  changed: boolean;
  pending: SavedReviewModel[];
  annotating: boolean;
  /** The page has unfinished input. */
  editorDirty: boolean;
  send: 'Send' | 'Sending…' | 'Sent';
  /** Send can run when the human has a pending review or an instruction. */
  sendable: boolean;
  /** The typed instruction is not saved yet. */
  instructionPending: boolean;
  instructionStatus: string;
  error: string;
  bridgeStatus: string;
  connecting: boolean;
  /** Scrollbar sizes of the page, in CSS pixels. */
  scrollbars: { right: number; bottom: number };
}
/** What the human does in the bar. */
export interface BarActions {
  instruction(value: string): void;
  send(): void;
  end(): void;
  reload(): void;
  /** Turn annotating on or off. The page confirms with its mode. */
  annotate(enabled: boolean, keyboard: boolean): void;
  open(reviewId: string): void;
  highlight(reviewId?: string): void;
  remove(saved: SavedReview): void;
  /** A press outside the page while the page has unfinished input. */
  outside(): void;
  /** The bar moved or changed size. */
  layout(): void;
}
/** Connect the workspace bar to the page and the session. */
export async function startWorkspace(
  id: string,
  plugins: ReadonlyMap<string, Plugin>,
) {
  const server = createSession(id, update);
  const state = {
    session: undefined as WorkspaceView | undefined,
    page: undefined as Pick<PageMessage, 'documentId' | 'revision'> | undefined,
    connected: false,
    annotating: false,
    editorDirty: false,
    sending: false,
    sent: false,
    instructionStatus: '',
    error: '',
    bridgeStatus: 'Connecting',
    connecting: true,
    scrollbars: { right: 0, bottom: 0 },
  };
  const available = new Map<string, boolean>();
  let attaching: string | undefined,
    instruction = '',
    instructionTimer: ReturnType<typeof setTimeout> | undefined,
    lastPresentation = '',
    /** The source revision that last reloaded the page on its own. */
    reloadedFor = '';
  let queued = false;
  function setState(changes: Partial<typeof state>) {
    Object.assign(state, changes);
    scheduleDraw();
  }
  function scheduleDraw() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      draw();
    });
  }
  function fail(error: string) {
    setState({ error });
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
      if (state.connected || !state.session) fail(errorMessage(e));
      setState({ connected: false, bridgeStatus: 'Disconnected' });
    }
  }
  function removeReview(reviewId: string, revision: string) {
    return write(
      `reviews/${encodeURIComponent(reviewId)}?revision=${encodeURIComponent(revision)}`,
      'DELETE',
    );
  }
  function update(next: WorkspaceView) {
    const previous = state.session;
    setState({ session: next, connected: true });
    if (!previous) view.load(next.page.frameUrl);
    else if (previous.page.origin !== next.page.origin) {
      attaching = undefined;
      setState({
        page: undefined,
        error: 'The service restarted. Refresh the page to reconnect.',
      });
    }
  }

  /** Whether a revision matches both the server and the attached page. */
  const fresh = (revision?: string) =>
    revision === state.session?.revision && revision === state.page?.revision;
  function presentation(current: WorkspaceView): Presentation {
    return {
      bar: view.barPosition(),
      pending: current.pending,
      previews: [...current.pending, ...current.sent].filter((saved) =>
        fresh(saved.revision),
      ),
      writable: !current.ended,
    };
  }
  function model(): BarModel {
    const current = state.session;
    const attached = state.page;
    const mutable = !!current && !current.ended;
    const agent = state.connected && mutable && current.agent !== 'idle';
    const pending = (current?.pending ?? []).map((saved) => {
      const stale = !fresh(saved.revision);
      return {
        saved,
        stale,
        unavailable: !stale && available.get(saved.review.id) === false,
      };
    });
    return {
      status: current?.ended
        ? 'ended'
        : !state.connected
          ? 'offline'
          : (current?.agent ?? 'idle'),
      agent,
      session: current,
      attached: !!attached,
      changed:
        !!attached && !!current && attached.revision !== current.revision,
      pending,
      annotating: state.annotating,
      editorDirty: state.editorDirty,
      send: state.sending ? 'Sending…' : state.sent ? 'Sent' : 'Send',
      sendable:
        !state.sending &&
        agent &&
        !state.editorDirty &&
        fresh(attached?.revision) &&
        !pending.some((saved) => saved.stale),
      instructionPending: instructionTimer !== undefined,
      instructionStatus: state.instructionStatus,
      error: state.error,
      bridgeStatus: state.bridgeStatus,
      connecting: state.connecting,
      scrollbars: state.scrollbars,
    };
  }
  /** Draw the bar, reload a changed file page, and send the page its presentation. */
  function draw() {
    const next = model();
    const current = state.session;
    // An HTML file reloads on its own when its source changes, once per revision.
    // Unfinished input blocks it. App pages keep the button: their HTML can differ on each request.
    if (
      current &&
      next.changed &&
      current.source.kind === 'file' &&
      !state.editorDirty &&
      reloadedFor !== current.revision
    ) {
      reloadedFor = current.revision;
      view.load(current.page.frameUrl);
    }
    view.update(next);
    if (!current) return;
    const params = presentation(current);
    const signature = JSON.stringify(params);
    if (state.page && lastPresentation !== signature) {
      lastPresentation = signature;
      bridge.post('update', params);
    }
  }

  function saveInstruction() {
    clearTimeout(instructionTimer);
    instructionTimer = undefined;
    scheduleDraw();
    return write('instruction', 'PUT', { instruction }).then(
      () => setState({ instructionStatus: 'Saved.' }),
      (e) => {
        setState({ instructionStatus: 'Not saved' });
        throw e;
      },
    );
  }
  let sentTimer: ReturnType<typeof setTimeout>;
  async function send() {
    if (state.sending) return;
    setState({ sending: true, sent: false });
    clearTimeout(sentTimer);
    try {
      if (instructionTimer !== undefined) await saveInstruction();
      if (state.editorDirty)
        throw new Error('Save or cancel your review before sending.');
      await write('send', 'POST', { revision: state.page?.revision });
      setState({ error: '', sent: true });
      sentTimer = setTimeout(() => setState({ sent: false }), 1500);
    } catch (e) {
      fail(errorMessage(e));
    } finally {
      setState({ sending: false });
    }
  }
  const actions: BarActions = {
    instruction(value) {
      state.sent = false;
      instruction = value;
      clearTimeout(instructionTimer);
      instructionTimer = setTimeout(() => {
        saveInstruction().catch((e) => fail(errorMessage(e)));
      }, 300);
      draw();
    },
    send: () => void send(),
    end() {
      write('end', 'POST', {}).catch((e) => fail(errorMessage(e)));
    },
    // Reload only the page frame at its current address.
    reload() {
      const current = state.session;
      if (current) view.load(current.page.frameUrl);
    },
    annotate(enabled, keyboard) {
      // Without an attached page, nothing can confirm. Annotating is off.
      if (state.page) bridge.post('annotate', { enabled, keyboard });
      else setState({ annotating: false });
    },
    open: (reviewId) => bridge.post('open', { reviewId }),
    highlight: (reviewId) =>
      bridge.post('highlight', reviewId ? { reviewId } : {}),
    remove(saved) {
      const reviewId = saved.review.id;
      if (
        plugins.get(saved.review.kind)?.workspace?.discardOnPage?.(saved) &&
        fresh(saved.revision)
      )
        bridge.post('discard', { reviewId, revision: saved.revision });
      else
        removeReview(reviewId, saved.revision).catch((e) =>
          fail(errorMessage(e)),
        );
    },
    outside: () => bridge.post('outside', {}),
    // The bar moved, so the page needs its new position.
    layout: draw,
  };

  /** Attach a page document. The SDK repeats `hello` until `init` arrives, so a failed attach retries. */
  async function attach(msg: PageMessage) {
    if (msg.documentId === attaching) return;
    attaching = msg.documentId;
    // The bar stops guarding the old page's unfinished input.
    setState({ page: undefined, editorDirty: false });
    lastPresentation = '';
    available.clear();
    try {
      await write('page', 'POST', { documentId: msg.documentId });
    } catch (e) {
      if (attaching === msg.documentId) {
        attaching = undefined;
        fail(errorMessage(e));
      }
      return;
    }
    const current = state.session;
    if (attaching !== msg.documentId || !current) return;
    setState({
      page: { documentId: msg.documentId, revision: msg.revision },
      connecting: false,
      bridgeStatus: 'Page connected',
    });
    const params = presentation(current);
    lastPresentation = JSON.stringify(params);
    bridge.post('init', { ...params, annotating: state.annotating });
  }
  const view = createBar(plugins, actions);
  const bridge = connectPage({
    frame: view.frame,
    page: () => state.session?.page,
    attached: (msg) => msg.documentId === state.page?.documentId,
    hello: (msg) => void attach(msg),
    failed: fail,
    requests: {
      // The page is not trusted. Each review passes the rules of its plugin before the server saves it.
      async save(params, revision) {
        const checked = prepareSave(
          plugins,
          state.session?.pending ?? [],
          params,
        );
        const { reviewId } = await write<{ reviewId: string }>(
          'reviews',
          'POST',
          { ...checked, revision },
        );
        setState({ sent: false, error: '' });
        return { reviewId, status: 'pending' };
      },
      async edit(params, revision) {
        const changes = prepareEdit(
          plugins,
          state.session?.pending ?? [],
          params,
        );
        await write(`reviews/${encodeURIComponent(params.reviewId)}`, 'PATCH', {
          ...changes,
          revision,
        });
        return null;
      },
      async remove({ reviewId, revision }, pageRevision) {
        await removeReview(reviewId, revision ?? pageRevision);
        return null;
      },
    },
    events: {
      annotating({ enabled }) {
        setState({ annotating: enabled });
        if (!enabled) view.focusToggle();
      },
      editing({ dirty }) {
        setState({ editorDirty: dirty });
      },
      notice({ message: text }) {
        fail(text);
      },
      availability({ items }) {
        for (const item of items) available.set(item.id, item.available);
        scheduleDraw();
      },
      scrollbars({ right, bottom }) {
        // Page input: keep each size between 0 and 40 pixels.
        const size = (value: number) =>
          Number.isFinite(value) ? Math.min(Math.max(value, 0), 40) : 0;
        setState({ scrollbars: { right: size(right), bottom: size(bottom) } });
      },
    },
  });
  draw();
  await sync();
  setInterval(sync, 1000);
  setTimeout(() => {
    if (!state.page)
      setState({
        connecting: false,
        error:
          'The page did not connect. Check its security policy or local server.',
      });
  }, 8000);
}
