/**
 * Annotating on the page. The page owns geometry and temporary editors. The parent owns saved feedback.
 * Pickers open editors. Each editor proposes its draft. This module names no kind and builds no markup.
 */
import type { Point } from '@/sdk/layout';
import { createOverlayView, listenOverlay, markerOf } from '@/sdk/overlay';
import type { Presentation } from '@/shared/bridge';
import { signal } from '@/shared/signal';
import {
  changeComment,
  changeInput,
  closeCapture,
  focusedComment,
  saveCapture,
  updateCapture,
} from './capture';
import { createCursor } from './cursor';
import { listenKeyboard } from './keyboard';
import { enableTextSelection, observeLayout } from './page';
import { isUnfinished } from './panel';
import { center, openReview } from './picking';
import { createPlacement, presentPlacement, schedule } from './placement';
import { listenPointer } from './pointer';
import {
  isEnabled,
  resolve,
  type AnnotatingBridge,
  type Annotator,
} from './state';
import type { Annotating } from './types';

export type { Annotator } from './state';

function onMarker(
  a: Annotator,
  id: string,
  point: Point | undefined,
  press: boolean,
) {
  if (press) a.pointer.markerPress = true;
  const { current } = a.capture;
  if (current?.saving) return;
  if (current && current.saved?.review.id !== id) closeCapture(a);
  openReview(a, id, point || center(markerOf(a.view, id)));
}

function onBeforeunload({ capture }: Annotator, event: BeforeUnloadEvent) {
  if (!isUnfinished(capture.current)) return;
  event.preventDefault();
  event.returnValue = '';
}

export function createAnnotating(bridge: AnnotatingBridge): Annotator {
  const a: Annotator = {
    bridge,
    view: createOverlayView(),
    pickers: [],
    writable: signal(false),
    annotating: signal(false),
    reported: new Map(),
    capture: { returnFocus: null },
    placement: createPlacement(),
    cursor: createCursor(),
    pointer: { markerPress: false },
    pending: [],
  };
  listenOverlay(a.view, {
    comment: (value) => changeComment(a, value),
    commentFocus: () => focusedComment(a),
    confirm: () => void saveCapture(a),
    cancel: () => closeCapture(a),
    remove: () => void saveCapture(a, true),
    marker: (id, point, press) => onMarker(a, id, point, press),
  });
  listenPointer(a);
  listenKeyboard(a);
  observeLayout(() => schedule(a));
  window.addEventListener('beforeunload', (event) => onBeforeunload(a, event));
  enableTextSelection(() => isEnabled(a));
  return a;
}

/** What page plugins use. */
export const pluginApi = (a: Annotator): Annotating => ({
  resolve: (saved) => resolve(a, saved),
  input: () => changeInput(a),
  confirm: () => void saveCapture(a),
  cancel: () => closeCapture(a),
});

export function present(
  a: Annotator,
  { bar, pending, writable }: Presentation,
) {
  const ids = new Set(pending.map(({ review }) => review.id));
  const saved = a.capture.current?.saved;
  // A new presentation may follow an attach. Report scrollbars again.
  a.reported.delete('scrollbars');
  a.pending = pending;
  a.writable.set(writable);
  presentPlacement(a, bar, ids);
  if (saved && !ids.has(saved.review.id)) closeCapture(a, true);
  if (!writable) a.bridge.post('annotating', { enabled: false });
  updateCapture(a);
}
