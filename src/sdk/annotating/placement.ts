/** Where the overlay draws: markers, the highlight, and the panel. */
import type { PageEvents, Presentation } from '../../shared/bridge.js';
import type { Availability, SavedReview } from '../../shared/feedback.js';
import type { MarkerLocal } from '../../shared/marker.js';
import { inView, markerPoint, panelPoint, type Point } from '../layout.js';
import type { MarkerModel, OverlayModel, OverlayView } from '../overlay.js';
import { findTarget } from '../targets.js';
import type { CaptureState } from './capture.js';
import type { Tools } from './tools.js';

interface Hooks {
  pending(): readonly SavedReview[];
  resolve(saved: SavedReview): Element | null;
  report<M extends 'availability' | 'scrollbars'>(
    method: M,
    params: PageEvents[M],
  ): void;
  render(): void;
}

export function createPlacement(
  view: OverlayView,
  tools: Tools,
  capture: CaptureState,
  hooks: Hooks,
) {
  let hovered: Element | undefined;
  let highlightedReview: string | undefined;
  let bar: Presentation['bar'] | undefined;
  let scheduled = false;
  /** The marker, highlight, and panel positions of the last positioning pass. */
  let layout: {
    markers: MarkerModel[];
    highlight?: OverlayModel['highlight'];
    panel?: Point;
  } = { markers: [] };
  function reviewMarkers() {
    const available: Availability[] = [];
    const markers: MarkerModel[] = [];
    for (const [index, saved] of hooks.pending().entries()) {
      if (!saved.review.target) continue;
      const el = hooks.resolve(saved);
      const { id, kind, comment } = saved.review;
      available.push({ id, available: !!el });
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (!inView(rect, innerHeight)) continue;
      const number = String(index + 1);
      const label = comment || (tools.find(kind)?.name ?? kind);
      markers.push({
        id,
        number,
        label: `Review ${number}: ${label}`,
        expanded: capture.current()?.saved?.review.id === id,
        highlighted: id === highlightedReview,
        ...markerPoint(rect, (saved.local as MarkerLocal | undefined)?.marker),
      });
    }
    return { available, markers };
  }
  function position() {
    scheduled = false;
    tools.layout();
    const captured = capture.current();
    const { available, markers } = reviewMarkers();
    const target = captured ? findTarget(captured.target) : hovered;
    const highlighted = highlightedReview
      ? hooks.pending().find((saved) => saved.review.id === highlightedReview)
      : undefined;
    const highlightedTarget = highlighted ? hooks.resolve(highlighted) : target;
    const highlight = highlightedTarget?.isConnected
      ? highlightedTarget.getBoundingClientRect()
      : null;
    const editorAnchor =
      target === highlightedTarget
        ? highlight
        : target?.isConnected
          ? target.getBoundingClientRect()
          : null;
    const height = window.visualViewport?.height || innerHeight;
    const panelSize = view.measurePanel((width) =>
      bar && bar.x < width + 22
        ? Math.min(height - 24, bar.y - 22)
        : height - 24,
    );
    layout = {
      markers,
      highlight: highlight ?? undefined,
      panel:
        panelSize && editorAnchor && captured
          ? panelPoint(
              {
                x: editorAnchor.left + captured.point.x,
                y: editorAnchor.top + captured.point.y,
              },
              panelSize,
              { width: innerWidth, height },
              bar,
            )
          : layout.panel,
    };
    hooks.render();
    hooks.report('availability', { items: available });
    hooks.report('scrollbars', {
      right: innerWidth - document.documentElement.clientWidth,
      bottom: innerHeight - document.documentElement.clientHeight,
    });
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(position);
    }
  }
  return {
    /** The positions of the last positioning pass. */
    layout: () => layout,
    position,
    schedule,
    hovered: () => hovered,
    /** Highlight the element that the human points at. */
    hover(el?: Element) {
      hovered = el;
      schedule();
    },
    /** Highlight the target of a pending review. */
    highlight(reviewId?: string) {
      highlightedReview = reviewId;
      schedule();
    },
    /** Follow a presentation. A removed pending review loses its marker at once, not at the next positioning pass. */
    present(next: Presentation['bar'], ids: ReadonlySet<string>) {
      bar = next;
      if (highlightedReview && !ids.has(highlightedReview))
        highlightedReview = undefined;
      layout = {
        ...layout,
        markers: layout.markers.filter((marker) => ids.has(marker.id)),
      };
    },
  };
}
