/** Use the same browser caret geometry for annotation and plain-text drops. */
export function caretAtPoint(
  point: { x: number; y: number },
  shadowRoots: ShadowRoot[],
): Range | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
      options: { shadowRoots: ShadowRoot[] },
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = doc.caretPositionFromPoint?.(point.x, point.y, {
    shadowRoots,
  });
  if (!caret) return doc.caretRangeFromPoint?.(point.x, point.y) || null;
  const range = document.createRange();
  range.setStart(caret.offsetNode, caret.offset);
  range.collapse(true);
  return range;
}

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
  if (!element || element.closest('[data-humagent-ui]')) return null;
  const caret = caretAtPoint(point, [...roots]);
  const node = caret?.startContainer || null;
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
          offset: Math.max(0, Math.min(caret!.startOffset, node.length)),
        },
      };
  }
  return { element };
}
