import { icon } from '../shared/icons.js';

export function createCommentCursor(observe: (root: ShadowRoot) => void) {
  const sheet = new CSSStyleSheet();
  const svg = icon('comment')
    .replace('currentColor', '#333')
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace('fill="none"', 'fill="white"');
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 3, crosshair`;
  sheet.replaceSync(
    `*{cursor:${cursor}!important}[data-humagent-text],[data-humagent-text] *{cursor:text!important}`,
  );
  const roots = new Set<Document | ShadowRoot>([document]);
  let enabled = false;
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
  return {
    discover() {
      attach(document);
    },
    watch(el: Element) {
      const root = el.getRootNode();
      if (root instanceof ShadowRoot) attach(root);
    },
    set(value: boolean) {
      enabled = value;
      if (enabled) attach(document);
      else
        for (const root of roots)
          root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
            (value) => value !== sheet,
          );
    },
  };
}
