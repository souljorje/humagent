export function selector(el: Element | null) {
  if (!el || !el.tagName) return '';
  const parts = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += '#' + CSS.escape(node.id);
      parts.unshift(part);
      break;
    }
    const parent: HTMLElement | null = node.parentElement;
    if (parent) {
      const same = [...parent.children].filter(
        (x) => x.tagName === node!.tagName,
      );
      if (same.length > 1)
        part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}
const interactiveSelector =
  "a[href],button,input,select,textarea,option,optgroup,label,summary,[contenteditable]:not([contenteditable='false']),[role='link'],[role='button'],[role='checkbox'],[role='combobox'],[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio'],[role='option'],[role='radio'],[role='switch'],[role='tab'],[role='treeitem'],[role='textbox'],[role='slider'],[role='spinbutton'],[role='listbox'],[role='grid']";
export function isNativeInteractiveControl(
  target: EventTarget | null,
): boolean {
  let el = target;
  while (el instanceof Element) {
    if (el.closest(interactiveSelector)) return true;
    const root = el.getRootNode();
    el = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}
export function context(el: Element, text: string) {
  const shadowPath: string[] = [];
  let root = el.getRootNode();
  while (root instanceof ShadowRoot) {
    shadowPath.unshift(selector(root.host));
    root = root.host.getRootNode();
  }
  return {
    ...(shadowPath.length ? { shadowPath } : {}),
    id: el.getAttribute('data-humagent-id') || el.id || '',
    selector: selector(el),
    tag: el.tagName.toLowerCase(),
    text: text.trim().replace(/\s+/g, ' ').slice(0, 4000),
  };
}

export function buildContext(
  text: string,
  start: number,
  end: number,
  pad = 32,
) {
  return {
    prefix: text.slice(Math.max(0, start - pad), start),
    quote: text.slice(start, end),
    suffix: text.slice(end, Math.min(text.length, end + pad)),
  };
}
