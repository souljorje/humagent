/** The state of annotating. Each part changes its own field only. */
import type { OverlayView } from '@/sdk/overlay';
import { resolveTarget } from '@/sdk/targets';
import type { Bootstrap, PageEvents, Requests } from '@/shared/bridge';
import type { NewReview, SaveResult, SavedReview } from '@/shared/feedback';
import type { MarkerPosition } from '@/shared/marker';
import type { Signal } from '@/shared/signal';
import type { CaptureState } from './capture';
import type { CursorState } from './cursor';
import type { PlacementState } from './placement';
import type { PointerState } from './pointer';
import type { Tool } from './types';

/** The workspace requests that save an editor's input. */
export interface ReviewRequests {
  save(
    review: NewReview,
    options: { marker: MarkerPosition },
  ): Promise<SaveResult>;
  edit(params: Requests['edit']['params']): Promise<null>;
  remove(reviewId: string): Promise<null>;
}
export interface AnnotatingBridge extends ReviewRequests {
  readonly boot: Bootstrap;
  notice(message: string): void;
  post<M extends keyof PageEvents>(method: M, params: PageEvents[M]): void;
}
export interface Annotator {
  readonly bridge: AnnotatingBridge;
  readonly view: OverlayView;
  /** Pickers in the order they handle new selections. */
  readonly tools: Tool[];
  readonly writable: Signal<boolean>;
  readonly annotating: Signal<boolean>;
  /** The last report of each state, so the workspace hears about changes only. */
  readonly reported: Map<string, string>;
  readonly capture: CaptureState;
  readonly placement: PlacementState;
  readonly cursor: CursorState;
  readonly pointer: PointerState;
  pending: readonly SavedReview[];
}

export const isEnabled = ({ annotating, writable }: Annotator) =>
  annotating() && writable();

export const resolve = ({ bridge }: Annotator, saved: SavedReview) =>
  resolveTarget(saved, bridge.boot);

/** Tell the workspace about a state that changed. */
export function report<M extends 'availability' | 'scrollbars' | 'editing'>(
  { bridge, reported }: Annotator,
  method: M,
  params: PageEvents[M],
) {
  const signature = JSON.stringify(params);
  if (reported.get(method) === signature) return;
  reported.set(method, signature);
  bridge.post(method, params);
}
