/** Capture a page element and find it again on the same revision. */
import type { SavedReview, Target } from '../shared/feedback.js';

export function isTarget(el: EventTarget | null): el is Element {
  return (
    el instanceof Element &&
    el !== document.documentElement &&
    !el.closest('[data-humagent-ui],script,style,head')
  );
}

/** Adapted helper. See [notices](../../README.md#third-party-notices). */
function selector(el: Element) {
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
/** The selector already names the tag. An element without a stable ID sends none. */
export function describeTarget(
  el: Element,
  url: string,
  text: string,
  range?: Range,
): Target {
  const id = el.getAttribute('data-humagent-id') || el.id;
  const target: Target = {
    ...(id ? { id } : {}),
    selector: selector(el),
    text: text.trim().replace(/\s+/g, ' ').slice(0, 4000),
    url,
  };
  if (range) {
    const prefix = range.cloneRange(),
      suffix = range.cloneRange();
    prefix.selectNodeContents(el);
    prefix.setEnd(range.startContainer, range.startOffset);
    suffix.selectNodeContents(el);
    suffix.setStart(range.endContainer, range.endOffset);
    target.anchor = {
      quote: range.toString(),
      prefix: prefix.toString().slice(-32),
      suffix: suffix.toString().slice(0, 32),
    };
  }
  return target;
}

/** A missing, ambiguous, or invalid selector has no target. */
export function findTarget(target: Target): Element | null {
  try {
    const id = target.id ? CSS.escape(String(target.id)) : undefined;
    const matches = document.querySelectorAll(
      id !== undefined
        ? `[data-humagent-id="${id}"],#${id}`
        : String(target.selector || ''),
    );
    const match = matches.item(0);
    return matches.length === 1 && isTarget(match) ? match : null;
  } catch {
    return null;
  }
}

export function resolveTarget(
  saved: SavedReview,
  page: { revision: string; sourceUrl: string },
): Element | null {
  const target = saved.review.target;
  if (
    !target ||
    saved.revision !== page.revision ||
    target.url !== page.sourceUrl
  )
    return null;
  return findTarget(target);
}
