import { icon } from '../shared/icons.js';
import { hitTestText } from './text-hit.js';

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
    `[data-humagent-cursor=comment]{cursor:${cursor}!important}[data-humagent-cursor=text],[data-humagent-text],[data-humagent-text] *{cursor:text!important;user-select:text!important;-webkit-user-select:text!important}`,
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
    const result = hitTestText(
      point,
      [...roots].filter(
        (root): root is ShadowRoot => root instanceof ShadowRoot,
      ),
      eligible,
    );
    if (!result) return restore();
    const hit = result.element;
    const nextKind = result.text ? 'text' : 'comment';
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
