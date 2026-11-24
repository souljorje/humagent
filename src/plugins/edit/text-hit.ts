import { LIMITS } from '../../shared/feedback.js';

/** The caret under a point, from the browser's own text geometry. */
export function caretAtPoint(point: { x: number; y: number }): Range | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = doc.caretPositionFromPoint?.(point.x, point.y);
  if (!caret) return doc.caretRangeFromPoint?.(point.x, point.y) || null;
  const range = document.createRange();
  range.setStart(caret.offsetNode, caret.offset);
  range.collapse(true);
  return range;
}

/** Resolve the text actually under the pointer, rather than the nearest text in page padding. */
export function hitTestText(
  point: { x: number; y: number },
  eligible: (node: Node | null) => node is Text,
): { node: Text; offset: number } | undefined {
  const element = document.elementFromPoint(point.x, point.y);
  if (!element || element.closest('[data-humagent-ui]')) return;
  const caret = caretAtPoint(point);
  const node = caret?.startContainer || null;
  if (!eligible(node) || !element.contains(node)) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  if (
    [...range.getClientRects()].some(
      (rect) =>
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom,
    )
  )
    return {
      node,
      offset: Math.max(0, Math.min(caret!.startOffset, node.length)),
    };
}

/** The single text node that a selection covers, with the selected offsets. */
export function selectedRun(range: Range) {
  let node = range.startContainer;
  if (node !== range.endContainer) return null;
  if (
    node instanceof Element &&
    node.childNodes.length === 1 &&
    range.startOffset === 0 &&
    range.endOffset === 1
  )
    node = node.firstChild!;
  if (!(node instanceof Text) || !node.parentElement) return null;
  return {
    node,
    start: node === range.startContainer ? range.startOffset : 0,
    end: node === range.endContainer ? range.endOffset : node.length,
  };
}

/** Plain text outside Humagent UI, native fields, and application editors. */
export function isEditableText(node: Node | null): node is Text {
  return (
    node instanceof Text &&
    !!node.data.trim() &&
    node.length <= LIMITS.text &&
    node.parentElement instanceof HTMLElement &&
    !node.parentElement.closest(
      '[data-humagent-ui],script,style,head,input,textarea,select,option,optgroup,[contenteditable]:not([contenteditable="false"])',
    )
  );
}
