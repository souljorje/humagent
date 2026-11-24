/** The inline text editor: one editable span in place of a text node. It reports input and makes no requests. */
import { caretAtPoint } from './text-hit.js';

const lf = (value = '') => value.replace(/\r\n/g, '\n');
function plainText(node: Node): string {
  if (node instanceof Text) return node.data;
  if (node instanceof HTMLBRElement)
    return node.hasAttribute('data-humagent-placeholder') ? '' : '\n';
  return [...node.childNodes].map(plainText).join('');
}

export function createEditor(
  initial: string,
  actions: { input(): void; confirm(): void; cancel(): void },
) {
  const element = document.createElement('span');
  element.dataset.humagentUi = '';
  element.dataset.humagentText = '';
  // Native plaintext-only editing forces pre-wrap, exposing HTML indentation.
  // Preserve application whitespace and handle plain-text input below.
  element.contentEditable = 'true';
  element.setAttribute('role', 'textbox');
  element.setAttribute('aria-label', 'Edit text');
  element.setAttribute('aria-multiline', 'true');
  element.spellcheck = false;
  element.style.cssText =
    'display:inline;white-space:inherit;outline:none;cursor:text;min-width:1ch;';
  element.textContent = initial;
  if (!initial) element.style.display = 'inline-block';
  element.addEventListener('input', (event) => {
    event.stopPropagation();
    element.style.display = element.textContent ? 'inline' : 'inline-block';
    actions.input();
  });
  element.addEventListener('change', (event) => event.stopPropagation());
  function insert(value: string) {
    if (element.contentEditable !== 'true') return;
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const fragment = document.createDocumentFragment();
    for (const [index, line] of value.split('\n').entries()) {
      if (index) fragment.append(document.createElement('br'));
      fragment.append(document.createTextNode(line));
    }
    const last = fragment.lastChild as Text;
    range.insertNode(fragment);
    // A trailing line break needs a following node, or the browser does not show the new line.
    if (!element.querySelector('[data-humagent-placeholder]')) {
      const end = document.createElement('br');
      end.dataset.humagentPlaceholder = '';
      element.append(end);
    }
    range.setStart(last, last.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    actions.input();
  }
  element.addEventListener('paste', (event) => {
    event.preventDefault();
    event.stopPropagation();
    insert(lf(event.clipboardData?.getData('text/plain')));
  });
  element.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const range = caretAtPoint({ x: event.clientX, y: event.clientY });
    if (!range || !element.contains(range.commonAncestorContainer)) return;
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    insert(lf(event.dataTransfer?.getData('text/plain')));
  });
  element.addEventListener('beforeinput', (event) => {
    if (event.isComposing) return;
    if (
      /^(format|insertOrderedList|insertUnorderedList|insertLink|insertHorizontalRule)/.test(
        event.inputType,
      )
    ) {
      event.preventDefault();
    } else if (event.inputType === 'insertLineBreak') {
      event.preventDefault();
      insert('\n');
    } else if (event.inputType === 'insertParagraph') {
      event.preventDefault();
      actions.confirm();
    }
  });
  element.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      actions.cancel();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) insert('\n');
      else actions.confirm();
    }
  });
  return {
    element,
    /** The edited text, with line feeds for line breaks. */
    value: () => lf(plainText(element)),
    /** Focus the editor and select a part of its text. Call after the element is in the page. */
    select(start: number, end: number) {
      element.focus({ preventScroll: true });
      const text = element.firstChild;
      if (!text) return;
      const range = document.createRange();
      range.setStart(text, Math.min(start, text.textContent!.length));
      range.setEnd(text, Math.min(end, text.textContent!.length));
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    setReadOnly(value: boolean) {
      element.contentEditable = value ? 'false' : 'true';
    },
  };
}
