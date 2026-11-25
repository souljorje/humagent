/** The inline text editor: one editable span in place of a text node. It reports input and makes no requests. */
import { createElement } from '@/shared/dom';
import { caretAtPoint } from './text-hit';

interface EditorActions {
  input(): void;
  confirm(): void;
  cancel(): void;
}
/** What a key or an input event asks for. */
type Intent = 'break' | 'confirm' | 'cancel' | 'ignore';

const FORMATTING =
  /^(format|insertOrderedList|insertUnorderedList|insertLink|insertHorizontalRule)/;

const lf = (value = '') => value.replace(/\r\n/g, '\n');

function plainText(node: Node): string {
  if (node instanceof Text) return node.data;
  if (node instanceof HTMLBRElement)
    return node.hasAttribute('data-humagent-placeholder') ? '' : '\n';
  return Array.from(node.childNodes, plainText).join('');
}

function keyIntent(key: string, shift: boolean): Intent | undefined {
  if (key === 'Escape') return 'cancel';
  if (key === 'Enter') return shift ? 'break' : 'confirm';
  return undefined;
}

function inputIntent(type: string): Intent | undefined {
  if (type === 'insertLineBreak') return 'break';
  if (type === 'insertParagraph') return 'confirm';
  return FORMATTING.test(type) ? 'ignore' : undefined;
}

/** Text with a line break element for each line feed. */
function fragmentOf(value: string) {
  const fragment = document.createDocumentFragment();
  for (const [index, line] of value.split('\n').entries()) {
    if (index) fragment.append(createElement('br'));
    fragment.append(document.createTextNode(line));
  }
  return fragment;
}

function selectRange(range: Range) {
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** The selected range, when it is inside an element. */
function rangeIn(element: HTMLElement) {
  const selection = getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  return range && element.contains(range.commonAncestorContainer)
    ? range
    : undefined;
}

/** Replace the selection in the editor with plain text. */
function insert(element: HTMLElement, value: string, actions: EditorActions) {
  const range = rangeIn(element);
  if (element.contentEditable !== 'true' || !range) return;
  const fragment = fragmentOf(value);
  const last = fragment.lastChild as Text;
  range.deleteContents();
  range.insertNode(fragment);
  // A trailing line break needs a following node, or the browser does not show the new line.
  if (!element.querySelector('[data-humagent-placeholder]'))
    element.append(
      createElement('br', { dataset: { humagentPlaceholder: '' } }),
    );
  range.setStart(last, last.length);
  range.collapse(true);
  selectRange(range);
  actions.input();
}

function apply(intent: Intent, element: HTMLElement, actions: EditorActions) {
  if (intent === 'break') insert(element, '\n', actions);
  else if (intent !== 'ignore') actions[intent]();
}

function showEmpty(element: HTMLElement) {
  element.toggleAttribute('data-humagent-empty', !element.textContent);
}

function onInput(event: Event, element: HTMLElement, actions: EditorActions) {
  event.stopPropagation();
  showEmpty(element);
  actions.input();
}

function onPaste(
  event: ClipboardEvent,
  element: HTMLElement,
  actions: EditorActions,
) {
  event.preventDefault();
  event.stopPropagation();
  insert(element, lf(event.clipboardData?.getData('text/plain')), actions);
}

function onDrop(
  event: DragEvent,
  element: HTMLElement,
  actions: EditorActions,
) {
  event.preventDefault();
  event.stopPropagation();
  const range = caretAtPoint({ x: event.clientX, y: event.clientY });
  if (!range || !element.contains(range.commonAncestorContainer)) return;
  selectRange(range);
  insert(element, lf(event.dataTransfer?.getData('text/plain')), actions);
}

function onBeforeInput(
  event: InputEvent,
  element: HTMLElement,
  actions: EditorActions,
) {
  const intent = event.isComposing ? undefined : inputIntent(event.inputType);
  if (!intent) return;
  event.preventDefault();
  apply(intent, element, actions);
}

function onKeydown(
  event: KeyboardEvent,
  element: HTMLElement,
  actions: EditorActions,
) {
  event.stopPropagation();
  if (event.isComposing || event.keyCode === 229) return;
  const intent = keyIntent(event.key, event.shiftKey);
  if (!intent) return;
  event.preventDefault();
  apply(intent, element, actions);
}

/**
 * Native plaintext-only editing forces pre-wrap, exposing HTML indentation.
 * Preserve application whitespace and handle plain-text input here.
 */
export function createEditor(initial: string, actions: EditorActions) {
  const element = createElement('span', {
    className: 'ha-edit-editor',
    dataset: { humagentUi: '', humagentText: '' },
    contentEditable: 'true',
    role: 'textbox',
    ariaLabel: 'Edit text',
    ariaMultiLine: 'true',
    spellcheck: false,
    textContent: initial,
  });
  showEmpty(element);
  element.addEventListener('input', (e) => onInput(e, element, actions));
  element.addEventListener('change', (e) => e.stopPropagation());
  element.addEventListener('paste', (e) => onPaste(e, element, actions));
  element.addEventListener('drop', (e) => onDrop(e, element, actions));
  element.addEventListener('beforeinput', (e) =>
    onBeforeInput(e, element, actions),
  );
  element.addEventListener('keydown', (e) => onKeydown(e, element, actions));
  return element;
}

/** The edited text, with line feeds for line breaks. */
export const editorText = (element: HTMLElement) => lf(plainText(element));

/** Focus the editor and select a part of its text. Call after the element is in the page. */
export function selectText(element: HTMLElement, start: number, end: number) {
  element.focus({ preventScroll: true });
  const text = element.firstChild;
  if (!text) return;
  const { length } = text.textContent!;
  const range = document.createRange();
  range.setStart(text, Math.min(start, length));
  range.setEnd(text, Math.min(end, length));
  selectRange(range);
}

export function setReadOnly(element: HTMLElement, value: boolean) {
  element.contentEditable = value ? 'false' : 'true';
}
