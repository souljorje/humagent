/** Adapted helpers. See [notices](../../README.md#third-party-notices). */
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
export function isNativeInteractiveControl(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(interactiveSelector);
}
export function context(el: Element, text: string) {
  return {
    id: el.getAttribute('data-humagent-id') || el.id || '',
    selector: selector(el),
    tag: el.tagName.toLowerCase(),
    text: text.trim().replace(/\s+/g, ' ').slice(0, 4000),
  };
}
