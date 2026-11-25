/** Workspace logic: session state, page attachment, and the feedback flow. It builds no markup. */
import type {
  SavedReview,
  Unsaved,
  WorkspaceView,
} from '../shared/feedback.js';
import type { PageMessage, Presentation } from '../shared/bridge.js';
import type { Plugin } from '../shared/plugin.js';
import { prepareEdit, prepareSave } from './reviews.js';
import { createSession } from './session.js';
import { connectPage } from './page-bridge.js';
import { errorMessage } from '../shared/errors.js';
import { effect, signal } from '../shared/signal.js';

export type AgentStatus =
  'ended' | 'offline' | 'connected' | 'sent' | 'working' | 'idle';
function agentStatus(
  current: WorkspaceView | undefined,
  connected: boolean,
): AgentStatus {
  if (current?.ended) return 'ended';
  if (!connected) return 'offline';
  return current?.agent ?? 'idle';
}
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
/** What the logic asks of the bar view. */
export interface BarView {
  frame: HTMLIFrameElement;
  update(model: BarModel): void;
  /** Top-left corner of the bar, in frame viewport pixels. */
  barPosition(): { x: number; y: number };
  /** Load a page in the frame. Pending reviews stay in the bar. */
  load(url: string): void;
  focusToggle(): void;
}

/**
 * The server owns all feedback. The workspace shows its latest view.
 * State that the bar shows lives in signals. One effect draws the bar after any of them changes.
 */
export function createWorkspace(
  id: string,
  plugins: ReadonlyMap<string, Plugin>,
) {
  const server = createSession(id, update);
  let view!: BarView;
  let bridge!: ReturnType<typeof connectPage>;
  const session = signal<WorkspaceView | undefined>(undefined);
  /** The page document attached to the server, after its handshake. */
  const page = signal<{ documentId: string; revision: string } | undefined>(
    undefined,
  );
  const connected = signal(false);
  const annotating = signal(false);
  const editorDirty = signal(false);
  /** Plugin input on the page that the server does not hold yet. */
  const unsaved = signal<Unsaved | null>(null);
  const sending = signal(false);
  const sent = signal(false);
  /** The typed instruction is not saved yet. */
  const instructionPending = signal(false);
  const instructionStatus = signal('');
  const message = signal('');
  const bridgeStatus = signal('Connecting');
  const connecting = signal(true);
  const scrollbars = signal({ right: 0, bottom: 0 });
  const available = signal(new Map<string, boolean>());
  /** Resolve the Send that waits for plugin input. */
  let resume: (() => void) | undefined;
  // Not shown in the bar, so no effect depends on these.
  let attaching: string | undefined,
    instruction = '',
    /** Counts edits, so an older save cannot confirm newer text. */
    instructionEdit = 0,
    instructionTimer: ReturnType<typeof setTimeout> | undefined,
    lastPresentation = '',
    /** The source revision that last reloaded the page on its own. */
    reloadedFor = '';
  /** Draw the bar now. `start` replaces it with the effect. */
  let render = () => {};

  /** Show an error above the bar. Without a message, clear the error. */
  function fail(text = '') {
    message.set(text);
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
      if (connected() || !session()) fail(errorMessage(e));
      connected.set(false);
      bridgeStatus.set('Disconnected');
    }
  }
  function removeReview(reviewId: string, revision: string) {
    return write(
      `reviews/${encodeURIComponent(reviewId)}?revision=${encodeURIComponent(revision)}`,
      'DELETE',
    );
  }
  function update(next: WorkspaceView) {
    const previous = session();
    session.set(next);
    connected.set(true);
    if (!previous) view.load(next.page.frameUrl);
    else if (previous.page.origin !== next.page.origin) {
      attaching = undefined;
      page.set(undefined);
      fail('The service restarted. Refresh the page to reconnect.');
    }
  }

  /** Whether a revision matches both the server and the attached page. */
  const fresh = (revision?: string) =>
    revision === session()?.revision && revision === page()?.revision;
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
  function pendingReview(saved: SavedReview): SavedReviewModel {
    const stale = !fresh(saved.revision);
    return {
      saved,
      stale,
      unavailable: !stale && available().get(saved.review.id) === false,
    };
  }
  function model(): BarModel {
    const current = session();
    const attached = page();
    const status = agentStatus(current, connected());
    const agent =
      status === 'connected' || status === 'sent' || status === 'working';
    const pending = current?.pending.map(pendingReview) ?? [];
    return {
      status,
      agent,
      session: current,
      attached: !!attached,
      changed:
        !!attached && !!current && attached.revision !== current.revision,
      pending,
      annotating: annotating(),
      editorDirty: editorDirty(),
      send: sending() ? 'Sending…' : sent() ? 'Sent' : 'Send',
      sendable:
        !sending() &&
        agent &&
        !editorDirty() &&
        fresh(attached?.revision) &&
        !pending.some((saved) => saved.stale),
      // An ended session accepts no instruction.
      instructionPending: !!current && !current.ended && instructionPending(),
      instructionStatus: instructionStatus(),
      error: message(),
      bridgeStatus: bridgeStatus(),
      connecting: connecting(),
      scrollbars: scrollbars(),
    };
  }
  /** Draw the bar, reload a changed file page, and send the page its presentation. */
  function draw() {
    const next = model();
    const current = session();
    // An HTML file reloads on its own when its source changes, once per revision.
    // Unfinished or unsaved input blocks it. App pages keep the button: their HTML can differ on each request.
    if (
      current &&
      next.changed &&
      current.source.kind === 'file' &&
      !editorDirty() &&
      !unsaved() &&
      reloadedFor !== current.revision
    ) {
      reloadedFor = current.revision;
      view.load(current.page.frameUrl);
    }
    view.update(next);
    if (!current) return;
    const params = presentation(current);
    const signature = JSON.stringify(params);
    if (page() && lastPresentation !== signature) {
      lastPresentation = signature;
      bridge.post('update', params);
    }
  }

  function saveInstruction() {
    clearTimeout(instructionTimer);
    const edit = instructionEdit;
    return write('instruction', 'PUT', { instruction }).then(
      () => {
        // A newer edit still needs its own save.
        if (edit !== instructionEdit) return;
        instructionPending.set(false);
        instructionStatus.set('Saved.');
      },
      (e) => {
        instructionStatus.set('Not saved');
        throw e;
      },
    );
  }
  let sentTimer: ReturnType<typeof setTimeout>;
  async function send() {
    if (sending()) return;
    sending.set(true);
    sent.set(false);
    clearTimeout(sentTimer);
    try {
      if (instructionPending()) await saveInstruction();
      if (unsaved() === 'saving') {
        const waiting = page()?.documentId;
        // A page that went away never reports the end of its save.
        await new Promise<void>((resolve) => {
          resume = resolve;
          setTimeout(resolve, 5000);
        });
        if (unsaved() || page()?.documentId !== waiting)
          throw new Error('Some page input is not saved. Check it, then send.');
      }
      if (editorDirty())
        throw new Error('Save or cancel your review before sending.');
      await write('send', 'POST', { revision: page()?.revision });
      fail();
      sent.set(true);
      sentTimer = setTimeout(() => sent.set(false), 1500);
    } catch (e) {
      fail(errorMessage(e));
    } finally {
      sending.set(false);
    }
  }
  const actions: BarActions = {
    instruction(value) {
      sent.set(false);
      instruction = value;
      instructionEdit++;
      clearTimeout(instructionTimer);
      instructionTimer = setTimeout(() => {
        saveInstruction().catch((e) => fail(errorMessage(e)));
      }, 300);
      instructionPending.set(true);
      // The field's text is not a signal. Send depends on it.
      render();
    },
    send: () => void send(),
    end() {
      write('end', 'POST', {}).catch((e) => fail(errorMessage(e)));
    },
    // Reload only the page frame at its current address.
    reload() {
      const current = session();
      if (current) view.load(current.page.frameUrl);
    },
    annotate(enabled, keyboard) {
      // Without an attached page, nothing can confirm. Annotating is off.
      if (page()) bridge.post('annotate', { enabled, keyboard });
      else annotating.set(false);
    },
    open: (reviewId) => bridge.post('open', { reviewId }),
    highlight: (reviewId) =>
      bridge.post('highlight', reviewId ? { reviewId } : {}),
    remove(saved) {
      const reviewId = saved.review.id;
      // A keyed review can have a pending save on the page. Let the page cancel it first.
      if (saved.key !== undefined && fresh(saved.revision))
        bridge.post('discard', { reviewId, revision: saved.revision });
      else
        removeReview(reviewId, saved.revision).catch((e) =>
          fail(errorMessage(e)),
        );
    },
    outside: () => bridge.post('outside', {}),
    // The bar moved, so the page needs its new position.
    layout: () => render(),
  };

  /** Attach a page document. The SDK repeats `hello` until `init` arrives, so a failed attach retries. */
  async function attach(msg: PageMessage) {
    if (msg.documentId === attaching) return;
    attaching = msg.documentId;
    // The bar stops guarding the old page's unfinished input.
    page.set(undefined);
    editorDirty.set(false);
    setUnsaved(null);
    lastPresentation = '';
    available.set(new Map());
    try {
      await write('page', 'POST', { documentId: msg.documentId });
    } catch (e) {
      if (attaching === msg.documentId) {
        attaching = undefined;
        fail(errorMessage(e));
      }
      return;
    }
    const current = session();
    if (attaching !== msg.documentId || !current) return;
    page.set({ documentId: msg.documentId, revision: msg.revision });
    connecting.set(false);
    bridgeStatus.set('Page connected');
    const params = presentation(current);
    lastPresentation = JSON.stringify(params);
    bridge.post('init', { ...params, annotating: annotating() });
  }
  function setUnsaved(state: Unsaved | null) {
    unsaved.set(state);
    if (state !== 'saving') resume?.();
  }
  function connect() {
    bridge = connectPage({
      frame: view.frame,
      page: () => session()?.page,
      attached: (msg) => msg.documentId === page()?.documentId,
      hello: (msg) => void attach(msg),
      failed: fail,
      requests: {
        // The page is not trusted. Each review passes the rules of its plugin before the server saves it.
        async save(params, revision) {
          const checked = prepareSave(
            plugins,
            session()?.pending ?? [],
            params,
          );
          const { reviewId } = await write<{ reviewId: string }>(
            'reviews',
            'POST',
            { ...checked, revision },
          );
          sent.set(false);
          fail();
          return { reviewId, status: 'pending' };
        },
        async edit(params, revision) {
          const changes = prepareEdit(
            plugins,
            session()?.pending ?? [],
            params,
          );
          await write(
            `reviews/${encodeURIComponent(params.reviewId)}`,
            'PATCH',
            { ...changes, revision },
          );
          return null;
        },
        async remove({ reviewId, revision }, pageRevision) {
          await removeReview(reviewId, revision ?? pageRevision);
          return null;
        },
      },
      events: {
        annotating({ enabled }) {
          annotating.set(enabled);
          if (!enabled) view.focusToggle();
        },
        editing({ dirty }) {
          editorDirty.set(dirty);
        },
        unsaved: ({ state }) => setUnsaved(state),
        notice({ message: text }) {
          fail(text);
        },
        availability({ items }) {
          const next = new Map(available());
          for (const item of items) next.set(item.id, item.available);
          available.set(next);
        },
        scrollbars({ right, bottom }) {
          // Page input: keep each size between 0 and 40 pixels.
          const size = (value: number) =>
            Number.isFinite(value) ? Math.min(Math.max(value, 0), 40) : 0;
          scrollbars.set({ right: size(right), bottom: size(bottom) });
        },
      },
    });
  }
  return {
    actions,
    /** Connect the bar, read the session, and keep it current. */
    async start(bar: BarView) {
      view = bar;
      connect();
      render = effect(draw);
      await sync();
      setInterval(() => void sync(), 1000);
      setTimeout(() => {
        if (!page()) {
          connecting.set(false);
          fail(
            'The page did not connect. Check its security policy or local server.',
          );
        }
      }, 8000);
    },
  };
}
