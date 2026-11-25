/** Turn what the human points at into an open editor. */
import type { Bootstrap } from '../../shared/bridge.js';
import { LIMITS, type SavedReview } from '../../shared/feedback.js';
import type { Hit, Pick } from '../../shared/plugin.js';
import type { Point } from '../layout.js';
import type { OverlayView } from '../overlay.js';
import { describeTarget, isTarget } from '../targets.js';
import type { CaptureState } from './capture.js';
import type { RegisteredTool, Tools } from './tools.js';

interface Hooks {
  boot: Bootstrap;
  notice(message: string): void;
  writable(): boolean;
  pending(): readonly SavedReview[];
  resolve(saved: SavedReview): Element | null;
}

/** A point as an offset in an element. Without a point, its center. */
function anchor(el: Element, point?: Point): Point {
  const rect = el.getBoundingClientRect();
  return point
    ? { x: point.x - rect.left, y: point.y - rect.top }
    : { x: rect.width / 2, y: rect.height / 2 };
}
/** The center of an element in the viewport. */
export function center(el: Element | undefined): Point | undefined {
  const rect = el?.getBoundingClientRect();
  return rect?.width
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : undefined;
}

export function createPicking(
  view: OverlayView,
  tools: Tools,
  capture: CaptureState,
  hooks: Hooks,
) {
  /** Open the comment panel on an element. No tool claimed the pick. */
  function show(el: Element, range?: Range, point?: Point) {
    if (!isTarget(el) || !hooks.writable() || capture.outside()) return;
    const text = range ? range.toString() : tools.textOf(el);
    if (text.length > LIMITS.text) {
      hooks.notice('Select a smaller section (maximum 50,000 characters).');
      return;
    }
    capture.reopen();
    const target = describeTarget(
      el,
      hooks.boot.sourceUrl,
      range ? tools.textOf(el) : text,
      range,
    );
    capture.open({ target, el, point: anchor(el, point) });
  }
  /** Open a tool's inline editor for a claimed pick. The comment panel opens beside it. */
  function showTool(tool: RegisteredTool, hit: Hit, point?: Point) {
    if (!hooks.writable() || capture.outside()) return;
    capture.reopen(hit.saved && view.marker(hit.saved.review.id));
    // The target and the press position describe the element before the editor changes it.
    const described =
      hit.saved?.review.target ||
      describeTarget(hit.el, hooks.boot.sourceUrl, tools.textOf(hit.el));
    const offset = anchor(hit.el, point);
    const editor = hit.open();
    capture.open({
      target: hit.saved?.review.target || { ...described, ...editor.target },
      el: hit.el,
      ...(hit.saved ? { saved: hit.saved } : {}),
      point: offset,
      tool,
      editor,
    });
  }
  function pick(next: Pick) {
    const match = tools.hit(next);
    if (!match) return show(next.el, next.range, next.point);
    if (match.hit !== 'blocked') showTool(match.tool, match.hit, next.point);
  }
  /** Reopen a saved pending review. */
  function edit(reviewId: string, point?: Point) {
    const saved = hooks.pending().find((d) => d.review.id === reviewId);
    if (!saved || capture.outside()) return;
    const el = hooks.resolve(saved);
    const tool = tools.find(saved.review.kind);
    const hit = el && tool?.hit?.({ el, saved });
    if (!el || hit === 'blocked') {
      hooks.notice(
        'Target unavailable. Inspect or remove this review in the bar.',
      );
      return;
    }
    if (tool && hit) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      showTool(tool, hit, point || center(view.marker(reviewId)));
      return;
    }
    capture.reopen(view.marker(reviewId));
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    capture.open({
      target: saved.review.target!,
      el,
      saved,
      point: anchor(el, point || center(view.marker(reviewId))),
    });
  }
  /** Pick the current text selection. */
  function selectedText(point?: Point) {
    const selection = document.getSelection();
    if (!selection || !selection.rangeCount || !selection.toString().trim())
      return false;
    const range = selection.getRangeAt(0).cloneRange();
    const node = range.commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    if (!isTarget(el)) return false;
    if (!point) {
      const endpoint = range.cloneRange();
      endpoint.collapse(
        (selection as Selection & { direction?: string }).direction ===
          'backward' ||
          (selection.focusNode === range.startContainer &&
            selection.focusOffset === range.startOffset),
      );
      const rect = endpoint.getBoundingClientRect();
      if (rect.height) point = { x: rect.left, y: rect.bottom };
    }
    pick({ el, range, ...(point ? { point } : {}) });
    return true;
  }
  return { pick, edit, selectedText };
}
export type Picking = ReturnType<typeof createPicking>;
