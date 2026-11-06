import { isNativeInteractiveControl } from './targets.js';

/** Resolve the text actually under the pointer, rather than the nearest text in page padding. */
export function hitTestText(
  point: { x: number; y: number },
  shadowRoots: Iterable<ShadowRoot>,
  eligible: (node: Node | null) => node is Text,
): { element: Element; text?: { node: Text; offset: number } } | null {
  let element = document.elementFromPoint(point.x, point.y);
  const roots = new Set(shadowRoots);
  while (element?.shadowRoot) {
    roots.add(element.shadowRoot);
    const inner = element.shadowRoot.elementFromPoint(point.x, point.y);
    if (!inner || inner === element) break;
    element = inner;
  }
  if (
    !element ||
    element.closest('[data-humagent-ui]') ||
    isNativeInteractiveControl(element)
  )
    return null;
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
      options: { shadowRoots: ShadowRoot[] },
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = doc.caretPositionFromPoint?.(point.x, point.y, {
    shadowRoots: [...roots],
  });
  const fallback = caret ? null : doc.caretRangeFromPoint?.(point.x, point.y);
  const node = caret?.offsetNode || fallback?.startContainer || null;
  if (eligible(node) && element.contains(node)) {
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
        element,
        text: {
          node,
          offset: Math.max(
            0,
            Math.min(caret?.offset ?? fallback!.startOffset, node.length),
          ),
        },
      };
  }
  return { element };
}
