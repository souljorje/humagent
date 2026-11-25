/**
 * Annotating on the page. The page owns geometry and temporary editors. The parent owns saved feedback.
 * Tools decide which kind of review a pick becomes. This module names no kind and builds no markup.
 * Each part owns its state: the open editor, the pointed element, and the overlay's positions.
 */
import type {
  Bootstrap,
  PageEvents,
  Presentation,
} from '../../shared/bridge.js';
import type { SavedReview } from '../../shared/feedback.js';
import type { Annotating } from '../../shared/plugin.js';
import { signal } from '../../shared/signal.js';
import { createOverlayView } from '../overlay.js';
import { resolveTarget } from '../targets.js';
import { createCapture, type ReviewRequests } from './capture.js';
import { installKeyboard } from './keyboard.js';
import { enableTextSelection, observeLayout } from './page.js';
import { center, createPicking } from './picking.js';
import { createPlacement } from './placement.js';
import { installPointer } from './pointer.js';
import { createTools } from './tools.js';

interface AnnotatingBridge extends ReviewRequests {
  boot: Bootstrap;
  notice(message: string): void;
  post<M extends keyof PageEvents>(method: M, params: PageEvents[M]): void;
}

export function createAnnotating(bridge: AnnotatingBridge) {
  const { boot, notice, post } = bridge;
  let shown: readonly SavedReview[] = [];
  const writable = signal(false);
  const annotating = signal(false);
  const enabled = () => annotating() && writable();
  const pending = () => shown;
  /** The last report of each state, so the workspace hears about changes only. */
  const reported = new Map<string, string>();
  function report<M extends 'availability' | 'scrollbars' | 'editing'>(
    method: M,
    params: PageEvents[M],
  ) {
    const signature = JSON.stringify(params);
    if (reported.get(method) === signature) return;
    reported.set(method, signature);
    post(method, params);
  }
  const resolve = (saved: SavedReview) => resolveTarget(saved, boot);
  const tools = createTools();
  const view = createOverlayView({
    comment: (value) => capture.comment(value),
    commentFocus: () => capture.commentFocus(),
    confirm: () => void capture.save(),
    cancel: () => capture.close(),
    remove: () => void capture.save(true),
    marker(id, point, press) {
      if (press) pointer.markerPressed();
      const captured = capture.current();
      if (captured?.saving) return;
      if (captured && captured.saved?.review.id !== id) capture.close();
      picking.edit(id, point || center(view.marker(id)));
    },
  });
  const schedule = () => placement.schedule();
  const capture = createCapture(view, tools, {
    requests: bridge,
    writable,
    editing: (state) => report('editing', state),
    render,
    schedule,
    position: () => placement.position(),
    closed: () => placement.hover(),
  });
  const placement = createPlacement(view, tools, capture, {
    pending,
    resolve,
    report,
    render,
  });
  const picking = createPicking(view, tools, capture, {
    boot,
    notice,
    writable,
    pending,
    resolve,
  });
  const { hover, hovered } = placement;
  const pointer = installPointer(tools, capture, picking, { enabled, hover });
  const keyboard = installKeyboard(capture, picking, {
    enabled,
    setMode,
    hover,
    hovered,
    render,
    schedule,
  });
  function render() {
    const { markers, highlight, panel } = placement.layout();
    view.update({
      panel: capture.panel(panel),
      markers,
      pendingIds: shown.map((saved) => saved.review.id),
      highlight,
      hint: keyboard.hint(),
    });
  }
  function setMode(value: boolean, withKeyboard = false) {
    if (capture.outside()) {
      post('annotating', { enabled: enabled() });
      return;
    }
    capture.close();
    annotating.set(value);
    post('annotating', { enabled: enabled() });
    keyboard.start(enabled() && withKeyboard);
    render();
    schedule();
  }
  observeLayout(schedule);
  window.addEventListener('beforeunload', (event) => {
    if (!capture.unfinished()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  enableTextSelection(enabled);
  /** What page plugins use. */
  const api: Annotating = {
    resolve,
    input: capture.input,
    confirm: () => void capture.save(),
    cancel: () => capture.close(),
  };
  return {
    api,
    register: tools.register,
    outside: capture.outside,
    open: picking.edit,
    highlight: placement.highlight,
    setMode,
    present(presentation: Presentation) {
      // A new presentation may follow an attach. Report scrollbars again.
      reported.delete('scrollbars');
      shown = presentation.pending;
      writable.set(presentation.writable);
      const ids = new Set(shown.map((saved) => saved.review.id));
      placement.present(presentation.bar, ids);
      const saved = capture.current()?.saved;
      if (saved && !ids.has(saved.review.id)) capture.close(true);
      if (!presentation.writable) post('annotating', { enabled: false });
      capture.update();
    },
  };
}
