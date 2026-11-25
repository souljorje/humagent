/** Turn what the human points at into an open editor. */
import type { Point } from '@/sdk/layout';
import { markerOf } from '@/sdk/overlay';
import { describeTarget, isTarget } from '@/sdk/targets';
import { LIMITS } from '@/shared/feedback';
import { openCapture, prepareCapture, pressOutside } from './capture';
import { resolve, type Annotator } from './state';
import { findTool, hitTools, originalText, type RegisteredTool } from './tools';
import type { Hit, Pick } from './types';

const TOO_LONG = 'Select a smaller section (maximum 50,000 characters).';
const UNAVAILABLE =
  'Target unavailable. Inspect or remove this review in the bar.';

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

function scrollToTarget(el: Element) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Open the comment panel on an element. No tool claimed the pick. */
function openPanel(a: Annotator, { el, range, point }: Pick) {
  if (!isTarget(el) || !a.writable() || pressOutside(a)) return;
  const text = range ? range.toString() : originalText(a.tools, el);
  if (text.length > LIMITS.text) {
    a.bridge.notice(TOO_LONG);
    return;
  }
  prepareCapture(a);
  const target = describeTarget(
    el,
    a.bridge.boot.sourceUrl,
    range ? originalText(a.tools, el) : text,
    range,
  );
  openCapture(a, { target, el, point: anchor(el, point) });
}

/** Open a tool's inline editor for a claimed pick. The comment panel opens beside it. */
function openTool(
  a: Annotator,
  tool: RegisteredTool,
  hit: Hit,
  point: Point | undefined,
) {
  const { el, saved } = hit;
  if (!a.writable() || pressOutside(a)) return;
  prepareCapture(a, saved && markerOf(a.view, saved.review.id));
  // The target and the press position describe the element before the editor changes it.
  const described =
    saved?.review.target ??
    describeTarget(el, a.bridge.boot.sourceUrl, originalText(a.tools, el));
  const offset = anchor(el, point);
  const editor = hit.open();
  openCapture(a, {
    target: saved?.review.target ?? { ...described, ...editor.target },
    el,
    ...(saved ? { saved } : {}),
    point: offset,
    tool,
    editor,
  });
}

export function pick(a: Annotator, next: Pick) {
  const match = hitTools(a.tools, next);
  if (!match) openPanel(a, next);
  else if (match.hit !== 'blocked')
    openTool(a, match.tool, match.hit, next.point);
}

/** Reopen a saved pending review. */
export function openReview(a: Annotator, reviewId: string, point?: Point) {
  const saved = a.pending.find(({ review }) => review.id === reviewId);
  if (!saved || pressOutside(a)) return;
  const marker = markerOf(a.view, reviewId);
  const el = resolve(a, saved);
  const tool = findTool(a.tools, saved.review.kind);
  const hit = el && tool?.hit?.({ el, saved });
  if (!el || hit === 'blocked') {
    a.bridge.notice(UNAVAILABLE);
    return;
  }
  if (tool && hit) {
    scrollToTarget(el);
    openTool(a, tool, hit, point || center(marker));
    return;
  }
  prepareCapture(a, marker);
  scrollToTarget(el);
  openCapture(a, {
    target: saved.review.target!,
    el,
    saved,
    point: anchor(el, point || center(marker)),
  });
}

/** Where the selection ended, below its line. */
function selectionEnd(selection: Selection, range: Range): Point | undefined {
  const backward =
    (selection as Selection & { direction?: string }).direction ===
      'backward' ||
    (selection.focusNode === range.startContainer &&
      selection.focusOffset === range.startOffset);
  const end = range.cloneRange();
  end.collapse(backward);
  const rect = end.getBoundingClientRect();
  return rect.height ? { x: rect.left, y: rect.bottom } : undefined;
}

/** Pick the current text selection. */
export function pickSelection(a: Annotator, pressed?: Point) {
  const selection = document.getSelection();
  if (!selection?.rangeCount || !selection.toString().trim()) return;
  const range = selection.getRangeAt(0).cloneRange();
  const node = range.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  if (!isTarget(el)) return;
  const point = pressed ?? selectionEnd(selection, range);
  pick(a, { el, range, ...(point ? { point } : {}) });
}
