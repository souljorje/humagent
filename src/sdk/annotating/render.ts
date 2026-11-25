/** Draw the overlay from the state of annotating. */
import { updateOverlay } from '@/sdk/overlay';
import { panelModel } from './panel';
import type { Annotator } from './state';

export function render(a: Annotator) {
  const { markers, highlight, panel } = a.placement.layout;
  const { current } = a.capture;
  updateOverlay(a.view, {
    panel: current && panelModel(a.tools, current, a.writable(), panel),
    markers,
    pendingIds: a.pending.map((saved) => saved.review.id),
    highlight,
    hint: a.cursor.hint,
  });
}
