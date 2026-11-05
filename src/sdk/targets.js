export function selector(el) {
  if (!el || !el.tagName) return '';
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += '#' + CSS.escape(node.id);
      parts.unshift(part);
      break;
    }
    const parent = node.parentElement;
    if (parent) {
      const same = [...parent.children].filter(
        (x) => x.tagName === node.tagName,
      );
      if (same.length > 1)
        part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}
export function isNativeInteractiveControl(el) {
  if (!el || !el.closest) return false;
  if (
    el.closest(
      "a[href],button,input,select,textarea,option,optgroup,label,summary,[contenteditable]:not([contenteditable='false'])",
    )
  )
    return true;
  const widget = el.closest(
    "[role='link'],[role='button'],[role='checkbox'],[role='combobox'],[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio'],[role='option'],[role='radio'],[role='switch'],[role='tab'],[role='treeitem'],[role='textbox'],[role='slider'],[role='spinbutton'],[role='listbox'],[role='grid']",
  );
  if (!widget) return false;
  return true;
}
export function context(el) {
  return {
    id: el.getAttribute('data-humagent-id') || el.id || '',
    selector: selector(el),
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.textContent || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 4000),
  };
}

export function buildContext(text, start, end, pad = 32) {
  return {
    prefix: text.slice(Math.max(0, start - pad), start),
    quote: text.slice(start, end),
    suffix: text.slice(end, Math.min(text.length, end + pad)),
  };
}
