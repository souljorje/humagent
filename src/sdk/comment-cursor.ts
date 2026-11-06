import { icon } from '../shared/icons.js';
import { isNativeInteractiveControl } from './targets.js';

export function createCommentCursor(
  observe: (root: ShadowRoot) => void,
  eligible: (node: Node | null) => node is Text,
) {
  const sheet = new CSSStyleSheet();
  const svg = icon('comment')
    .replace('currentColor', '#333')
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace('fill="none"', 'fill="white"');
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 3, crosshair`;
  sheet.replaceSync(
    `[data-humagent-cursor=comment]{cursor:${cursor}!important}[data-humagent-cursor=text],[data-humagent-text],[data-humagent-text] *{cursor:text!important}`,
  );
  const roots = new Set<Document | ShadowRoot>([document]);
  let enabled = false;
  let frame = 0;
  let point: { x: number; y: number } | undefined;
  let hovered: Element | undefined;
  let kind = '';
  let prior: string | null = null;
  function restore() {
    if (hovered) {
      if (prior === null) hovered.removeAttribute('data-humagent-cursor');
      else hovered.setAttribute('data-humagent-cursor', prior);
    }
    hovered = undefined;
  }
  function clear() {
    point = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    restore();
  }
  function schedule() {
    if (enabled && point && !frame) frame = requestAnimationFrame(update);
  }
  function update() {
    frame = 0;
    if (!enabled || !point) return restore();
    let hit = document.elementFromPoint(point.x, point.y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(point.x, point.y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    if (
      !hit ||
      hit.closest('[data-humagent-ui]') ||
      isNativeInteractiveControl(hit)
    )
      return restore();
    const doc = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
        options: { shadowRoots: ShadowRoot[] },
      ) => { offsetNode: Node } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const node =
      doc.caretPositionFromPoint?.(point.x, point.y, {
        shadowRoots: [...roots].filter(
          (root): root is ShadowRoot => root instanceof ShadowRoot,
        ),
      })?.offsetNode ||
      doc.caretRangeFromPoint?.(point.x, point.y)?.startContainer;
    let nextKind = 'comment';
    if (eligible(node || null) && hit.contains(node!)) {
      const range = document.createRange();
      range.selectNodeContents(node!);
      if (
        [...range.getClientRects()].some(
          (rect) =>
            point!.x >= rect.left &&
            point!.x <= rect.right &&
            point!.y >= rect.top &&
            point!.y <= rect.bottom,
        )
      )
        nextKind = 'text';
    }
    if (hit === hovered && nextKind === kind) return;
    restore();
    hovered = hit;
    kind = nextKind;
    prior = hovered.getAttribute('data-humagent-cursor');
    hovered.setAttribute('data-humagent-cursor', kind);
  }
  function attach(root: Document | ShadowRoot) {
    if (root instanceof ShadowRoot && root.host.matches('[data-humagent-ui]'))
      return;
    if (!roots.has(root)) {
      roots.add(root);
      if (root instanceof ShadowRoot) observe(root);
    }
    if (enabled && !root.adoptedStyleSheets.includes(sheet))
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    for (const el of root.querySelectorAll('*'))
      if (el.shadowRoot) attach(el.shadowRoot);
  }
  document.addEventListener('scroll', schedule, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', schedule);
  return {
    discover() {
      attach(document);
      schedule();
    },
    watch(el: Element) {
      const root = el.getRootNode();
      if (root instanceof ShadowRoot && !roots.has(root)) attach(root);
    },
    move(x: number, y: number) {
      point = { x, y };
      schedule();
    },
    clear,
    set(value: boolean) {
      enabled = value;
      if (enabled) attach(document);
      else {
        clear();
        for (const root of roots)
          root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
            (value) => value !== sheet,
          );
      }
    },
  };
}
