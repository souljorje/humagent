/** Workspace logic: session state, page attachment, and the feedback flow. It builds no markup. */
import type { SavedReview, WorkspaceView } from '../../shared/feedback.js';
import type { PageMessage, Presentation } from '../../shared/bridge.js';
import type { Plugin } from '../../shared/plugin.js';
import { errorMessage } from '../../shared/errors.js';
import { effect, signal } from '../../shared/signal.js';
import { connectPage } from '../page-bridge.js';
import { prepareEdit, prepareSave } from '../reviews.js';
import { createSession } from '../session.js';
import { createInstruction } from './instruction.js';
import {
  agentStatus,
  type BarActions,
  type BarModel,
  type BarView,
  type SavedReviewModel,
} from './model.js';
import { createPageInput } from './page-input.js';

/**
 * The server owns all feedback. The workspace shows its latest view.
 * State that the bar shows lives in signals. One effect draws the bar after any of them changes.
 */
export function createWorkspace(
  id: string,
  plugins: ReadonlyMap<string, Plugin>,
) {
  const server = createSession(id, {
    view: update,
    failed: () => void sync(),
  });
  let view!: BarView;
  let bridge!: ReturnType<typeof connectPage>;
  const session = signal<WorkspaceView | undefined>(undefined);
  /** The page document attached to the server, after its handshake. */
  const page = signal<{ documentId: string; revision: string } | undefined>(
    undefined,
  );
  const connected = signal(false);
  const annotating = signal(false);
  const input = createPageInput();
  const instruction = createInstruction(server.setInstruction, fail);
  const sending = signal(false);
  const sent = signal(false);
  const message = signal('');
  const bridgeStatus = signal('Connecting');
  const connecting = signal(true);
  const scrollbars = signal({ right: 0, bottom: 0 });
  const available = signal(new Map<string, boolean>());
  // Not shown in the bar, so no effect depends on these.
  let attaching: string | undefined,
    lastPresentation = '',
    /** The source revision that last reloaded the page on its own. */
    reloadedFor = '';
  /** Draw the bar now. `start` replaces it with the effect. */
  let render = () => {};

  /** Show an error above the bar. Without a message, clear the error. */
  function fail(text = '') {
    message.set(text);
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
      editorDirty: input.editorDirty(),
      send: sending() ? 'Sending…' : sent() ? 'Sent' : 'Send',
      sendable:
        !sending() &&
        agent &&
        !input.editorDirty() &&
        fresh(attached?.revision) &&
        !pending.some((saved) => saved.stale),
      // An ended session accepts no instruction.
      instructionPending: !!current && !current.ended && instruction.pending(),
      instructionStatus: instruction.status(),
      error: message(),
      bridgeStatus: bridgeStatus(),
      connecting: connecting(),
      scrollbars: scrollbars(),
    };
  }
  /** Reload a changed file page. */
  function reloadChanged(current: WorkspaceView, changed: boolean) {
    // An HTML file reloads on its own when its source changes, once per revision.
    // Unfinished or unsaved input blocks it. App pages keep the button: their HTML can differ on each request.
    if (
      changed &&
      current.source.kind === 'file' &&
      !input.editorDirty() &&
      !input.unsaved() &&
      reloadedFor !== current.revision
    ) {
      reloadedFor = current.revision;
      view.load(current.page.frameUrl);
    }
  }
  /** Send the page its presentation when it differs from the last one. */
  function present(current: WorkspaceView) {
    const params = presentation(current);
    const signature = JSON.stringify(params);
    if (page() && lastPresentation !== signature) {
      lastPresentation = signature;
      bridge.post('update', params);
    }
  }
  function draw() {
    const next = model();
    const current = session();
    if (current) reloadChanged(current, next.changed);
    view.update(next);
    if (current) present(current);
  }

  let sentTimer: ReturnType<typeof setTimeout>;
  async function send() {
    if (sending()) return;
    sending.set(true);
    sent.set(false);
    clearTimeout(sentTimer);
    try {
      if (instruction.pending()) await instruction.flush();
      if (input.unsaved() === 'saving') {
        const waiting = page()?.documentId;
        await input.settled();
        if (input.unsaved() || page()?.documentId !== waiting)
          throw new Error('Some page input is not saved. Check it, then send.');
      }
      if (input.editorDirty())
        throw new Error('Save or cancel your review before sending.');
      await server.send(page()?.revision);
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
      instruction.edit(value);
      // The field's text is not a signal. Send depends on it.
      render();
    },
    send: () => void send(),
    end() {
      server.end().catch((e) => fail(errorMessage(e)));
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
        server
          .removeReview(reviewId, saved.revision)
          .catch((e) => fail(errorMessage(e)));
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
    input.reset();
    lastPresentation = '';
    available.set(new Map());
    try {
      await server.attachPage(msg.documentId);
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
          const { reviewId } = await server.saveReview({
            ...checked,
            revision,
          });
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
          await server.editReview(params.reviewId, { ...changes, revision });
          return null;
        },
        async remove({ reviewId, revision }, pageRevision) {
          await server.removeReview(reviewId, revision ?? pageRevision);
          return null;
        },
      },
      events: {
        annotating({ enabled }) {
          annotating.set(enabled);
          if (!enabled) view.focusToggle();
        },
        editing({ dirty }) {
          input.editorDirty.set(dirty);
        },
        unsaved: ({ state }) => input.report(state),
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
