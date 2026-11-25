/** Where the overlay draws: markers, the highlight, and the panel. */
import { inView, markerPoint, panelPoint, type Point } from '@/sdk/layout';
import {
  measurePanel,
  type MarkerModel,
  type OverlayModel,
} from '@/sdk/overlay';
import { findTarget } from '@/sdk/targets';
import type { Presentation } from '@/shared/bridge';
import type { SavedReview } from '@/shared/feedback';
import { render } from './render';
import { report, resolve, type Annotator } from './state';
import { findTool, layoutTools } from './tools';

export interface PlacementState {
  /** The element that the human points at. */
  hovered?: Element;
  highlightedReview?: string;
  bar?: Presentation['bar'];
  scheduled: boolean;
  /** The marker, highlight, and panel positions of the last positioning pass. */
  layout: {
    readonly markers: MarkerModel[];
    readonly highlight?: OverlayModel['highlight'];
    readonly panel?: Point;
  };
}
/** A pending review with its target on the page. */
interface Located {
  readonly saved: SavedReview;
  readonly number: string;
  readonly el: Element | null;
}

export const createPlacement = (): PlacementState => ({
  scheduled: false,
  layout: { markers: [] },
});

/** The marker of a review in view. */
function markersOf(
  { tools, capture, placement }: Annotator,
  { saved, number, el }: Located,
): MarkerModel[] {
  const rect = el?.getBoundingClientRect();
  if (!rect || !inView(rect, innerHeight)) return [];
  const { id, kind, comment } = saved.review;
  return [
    {
      id,
      number,
      label: `Review ${number}: ${comment || (findTool(tools, kind)?.name ?? kind)}`,
      expanded: capture.current?.saved?.review.id === id,
      highlighted: placement.highlightedReview === id,
      ...markerPoint(rect, saved.marker),
    },
  ];
}

const connectedRect = (el: Element | null | undefined) =>
  el?.isConnected ? el.getBoundingClientRect() : undefined;

/** The panel opens at the press. One that reaches the bar stays above it. */
function panelPosition(
  { view, capture, placement }: Annotator,
  anchor: DOMRect | undefined,
) {
  const { bar, layout } = placement;
  const { current } = capture;
  const height = window.visualViewport?.height || innerHeight;
  const size = measurePanel(view, (width) =>
    bar && bar.x < width + 22 ? Math.min(height - 24, bar.y - 22) : height - 24,
  );
  if (!size || !anchor || !current) return layout.panel;
  return panelPoint(
    { x: anchor.left + current.point.x, y: anchor.top + current.point.y },
    size,
    { width: innerWidth, height },
    bar,
  );
}

/** Run a positioning pass now. */
export function position(a: Annotator) {
  const { capture, pending, placement } = a;
  placement.scheduled = false;
  layoutTools(a.tools);
  const located: Located[] = pending.flatMap((saved, index) =>
    saved.review.target
      ? [{ saved, number: String(index + 1), el: resolve(a, saved) }]
      : [],
  );
  const pointed = capture.current
    ? findTarget(capture.current.target)
    : placement.hovered;
  // A highlighted review wins over the pointed element.
  const review = pending.find(
    (saved) => saved.review.id === placement.highlightedReview,
  );
  const highlighted = review ? resolve(a, review) : pointed;
  const highlight = connectedRect(highlighted);
  const anchor = pointed === highlighted ? highlight : connectedRect(pointed);
  placement.layout = {
    markers: located.flatMap((item) => markersOf(a, item)),
    highlight,
    panel: panelPosition(a, anchor),
  };
  render(a);
  report(a, 'availability', {
    items: located.map(({ saved, el }) => ({
      id: saved.review.id,
      available: !!el,
    })),
  });
  report(a, 'scrollbars', {
    right: innerWidth - document.documentElement.clientWidth,
    bottom: innerHeight - document.documentElement.clientHeight,
  });
}

/** Run one positioning pass in the next frame. */
export function schedule(a: Annotator) {
  if (a.placement.scheduled) return;
  a.placement.scheduled = true;
  requestAnimationFrame(() => position(a));
}

/** Highlight the element that the human points at. */
export function hover(a: Annotator, el?: Element) {
  a.placement.hovered = el;
  schedule(a);
}

/** Highlight the target of a pending review. */
export function highlight(a: Annotator, reviewId?: string) {
  a.placement.highlightedReview = reviewId;
  schedule(a);
}

/** Follow a presentation. A removed pending review loses its marker at once, not at the next positioning pass. */
export function presentPlacement(
  { placement }: Annotator,
  bar: Presentation['bar'],
  ids: ReadonlySet<string>,
) {
  const { highlightedReview, layout } = placement;
  placement.bar = bar;
  if (highlightedReview && !ids.has(highlightedReview))
    placement.highlightedReview = undefined;
  placement.layout = {
    ...layout,
    markers: layout.markers.filter((marker) => ids.has(marker.id)),
  };
}
