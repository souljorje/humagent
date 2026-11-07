import type { Draft, MarkerPosition } from '../shared/review.js';
import { caretAtPoint } from './text-hit.js';

interface Preview {
  draft: Draft;
  node: Text;
  target: Element;
  before: string;
  written: string;
  observer: MutationObserver;
  writes: number;
  owned: boolean;
}
interface Editing {
  node: Text;
  element: HTMLSpanElement;
  parent: Node;
  initial: string;
  before: string;
  endpoint?: MarkerPosition;
}

/** Own only the selected text node. Restore it only while our editor or preview still owns it. */
export function createTextEditing(hooks: {
  resolve(draft: Draft): Element | null;
  input(): void;
  confirm(): void;
  cancel(): void;
  invalidate(): void;
}) {
  const previews = new Map<string, Preview>();
  const nodes = new WeakMap<Text, Preview>();
  const suppressed = new Set<string>();
  let editing: Editing | undefined;
  function plainText(node: Node): string {
    if (node instanceof Text) return node.data;
    if (node instanceof HTMLBRElement)
      return node.hasAttribute('data-humagent-placeholder') ? '' : '\n';
    return [...node.childNodes].map(plainText).join('');
  }

  function mutations(
    preview: Preview,
    records = preview.observer.takeRecords(),
  ) {
    const own = Math.min(preview.writes, records.length);
    preview.writes -= own;
    if (records.length > own && preview.owned) {
      preview.owned = false;
      hooks.invalidate();
    }
  }
  function valid(preview: Preview) {
    mutations(preview);
    return (
      preview.owned &&
      ((preview.node.isConnected &&
        preview.node.parentNode === preview.target) ||
        (editing?.node === preview.node &&
          editing.element.parentNode === preview.target)) &&
      preview.node.data === preview.written
    );
  }
  function forget(id: string, preview: Preview) {
    preview.observer.disconnect();
    nodes.delete(preview.node);
    previews.delete(id);
  }
  function canonicalText(node: Node): string {
    if (editing?.element === node) return editing.before;
    if (node instanceof Text) {
      const preview = nodes.get(node);
      if (preview && valid(preview)) return preview.before;
      return node.data;
    }
    return [...node.childNodes].map(canonicalText).join('');
  }
  function nodeFor(draft: Draft, target: Element): Text | null {
    const index = draft.item.target?.textNode;
    if (!Number.isInteger(index) || typeof index !== 'number') return null;
    const node = target.childNodes[index];
    return node instanceof Text ? node : null;
  }
  function close() {
    if (!editing) return;
    document.removeEventListener('selectionchange', rememberCaret);
    const { node, element, parent } = editing;
    // A framework may have replaced the parent or removed the editor.
    if (element.isConnected && element.parentNode === parent)
      element.replaceWith(node);
    editing = undefined;
  }
  function editorRoots() {
    const roots: ShadowRoot[] = [];
    let root = editing?.element.getRootNode();
    while (root instanceof ShadowRoot) {
      roots.push(root);
      root = root.host.getRootNode();
    }
    return roots;
  }
  function rememberCaret() {
    if (!editing) return;
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    const range = selectionRange(selection, editorRoots());
    if (!editing.element.contains(range.commonAncestorContainer)) return;
    range.collapse(
      (selection as Selection & { direction?: string }).direction ===
        'backward',
    );
    let caret = range.getBoundingClientRect();
    const { startContainer: node, startOffset: offset } = range;
    let next =
      node instanceof Text
        ? offset === node.length
          ? node.nextSibling
          : null
        : node.childNodes[offset];
    while (next instanceof Text && !next.length) next = next.nextSibling;
    // Empty text can report the previous line. Its following BR owns the caret line.
    if (next instanceof HTMLBRElement) caret = next.getBoundingClientRect();
    const rect = caret.height ? caret : editing.element.getBoundingClientRect();
    const parent = editing.element.parentElement!.getBoundingClientRect();
    range.setStart(editing.element, 0);
    editing.endpoint = {
      x: (caret.height ? rect.right : rect.left) + 4 - parent.left,
      y: rect.top + rect.height / 2 - 16 - parent.top,
      textOffset: plainText(range.cloneContents()).replace(/\r\n/g, '\n')
        .length,
    };
  }
  function reconcile(drafts: Draft[]) {
    const wanted = new Map(drafts.map((draft) => [draft.item.id, draft]));
    for (const [id, preview] of previews) {
      if (editing?.node === preview.node) continue;
      if (!wanted.has(id)) {
        if (valid(preview)) preview.node.data = preview.before;
        forget(id, preview);
      } else if (
        !valid(preview) ||
        hooks.resolve(wanted.get(id)!) !== preview.target
      ) {
        // Stop drawing a preview after application changes. Keep the feedback attached.
        suppressed.add(id);
        if (valid(preview)) preview.node.data = preview.before;
        forget(id, preview);
      }
    }
    for (const id of suppressed) if (!wanted.has(id)) suppressed.delete(id);
    for (const draft of drafts) {
      const replacement = draft.item.replacement;
      if (!replacement || suppressed.has(draft.item.id)) continue;
      const previous = previews.get(draft.item.id);
      if (
        editing &&
        (previous?.node === editing.node ||
          (draft.item.target?.textNode !== undefined &&
            hooks.resolve(draft) === editing.parent &&
            editing.parent.childNodes[Number(draft.item.target.textNode)] ===
              editing.element))
      )
        continue;
      const target = previous?.target || hooks.resolve(draft);
      if (!target) continue;
      const node = previous?.node || nodeFor(draft, target);
      if (!node || (!previous && node.data !== replacement.before)) {
        suppressed.add(draft.item.id);
        continue;
      }
      const preview: Preview = previous || {
        draft,
        node,
        target,
        before: replacement.before,
        written: replacement.after,
        observer: new MutationObserver((records) =>
          mutations(preview, records),
        ),
        writes: 0,
        owned: true,
      };
      if (!previous) preview.observer.observe(node, { characterData: true });
      preview.draft = draft;
      preview.written = replacement.after;
      previews.set(draft.item.id, preview);
      nodes.set(node, preview);
      if (node.data !== replacement.after) {
        preview.writes++;
        node.data = replacement.after;
      }
    }
  }
  return {
    canonicalText,
    reconcile,
    close,
    nodeFor,
    existing(node: Text) {
      return [...previews.values()].find(
        (preview) => preview.node === node && valid(preview),
      )?.draft;
    },
    get element() {
      return editing?.element;
    },
    get value() {
      return editing ? plainText(editing.element).replace(/\r\n/g, '\n') : '';
    },
    get initial() {
      return editing?.initial ?? '';
    },
    markerPoint(draft: Draft) {
      const offset = draft.marker?.textOffset;
      const preview = previews.get(draft.item.id);
      if (
        offset === undefined ||
        !preview ||
        !valid(preview) ||
        !preview.node.isConnected
      )
        return;
      // A trailing preserved newline has no rendered caret line in a bare Text node.
      // Keep its measured editor-line anchor instead.
      if (
        offset === preview.node.length &&
        preview.node.data.endsWith('\n') &&
        /^(pre|pre-wrap|pre-line|break-spaces)$/.test(
          getComputedStyle(preview.target).whiteSpace,
        )
      )
        return;
      const range = document.createRange();
      range.setStart(preview.node, Math.min(offset, preview.node.length));
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height)
        return { x: rect.right + 4, y: rect.top + rect.height / 2 - 16 };
    },
    endpoint() {
      if (!editing?.element.isConnected) return;
      rememberCaret();
      if (!editing.endpoint) return;
      const rect = editing.element.parentElement!.getBoundingClientRect();
      return {
        x: rect.left + editing.endpoint.x,
        y: rect.top + editing.endpoint.y,
        textOffset: editing.endpoint.textOffset,
      };
    },
    open(
      node: Text,
      start: number,
      end: number,
      before: string,
      initial = node.data,
    ) {
      close();
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
      editing = {
        node,
        element,
        parent: node.parentNode!,
        initial,
        before,
      };
      node.replaceWith(element);
      element.addEventListener('input', (event) => {
        event.stopPropagation();
        element.style.display = element.textContent ? 'inline' : 'inline-block';
        rememberCaret();
        hooks.input();
      });
      element.addEventListener('change', (event) => event.stopPropagation());
      function insert(value: string) {
        if (element.contentEditable !== 'true') return;
        const selection = getSelection();
        if (!selection?.rangeCount) return;
        const range = selectionRange(selection, editorRoots());
        if (!element.contains(range.commonAncestorContainer)) return;
        range.deleteContents();
        const fragment = document.createDocumentFragment();
        for (const [index, line] of value.split('\n').entries()) {
          if (index) fragment.append(document.createElement('br'));
          fragment.append(document.createTextNode(line));
        }
        const last = fragment.lastChild as Text;
        range.insertNode(fragment);
        if (!element.querySelector('[data-humagent-placeholder]')) {
          const end = document.createElement('br');
          end.dataset.humagentPlaceholder = '';
          element.append(end);
        }
        range.setStart(last, last.length);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        rememberCaret();
        hooks.input();
      }
      element.addEventListener('paste', (event) => {
        event.preventDefault();
        event.stopPropagation();
        insert(
          event.clipboardData?.getData('text/plain').replace(/\r\n/g, '\n') ||
            '',
        );
      });
      element.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const range = caretAtPoint(
          { x: event.clientX, y: event.clientY },
          editorRoots(),
        );
        if (!range || !element.contains(range.commonAncestorContainer)) return;
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        insert(
          event.dataTransfer?.getData('text/plain').replace(/\r\n/g, '\n') ||
            '',
        );
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
          hooks.confirm();
        }
      });
      element.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          hooks.cancel();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (event.shiftKey) insert('\n');
          else hooks.confirm();
        }
      });
      element.focus({ preventScroll: true });
      const text = element.firstChild;
      if (text) {
        const range = document.createRange();
        range.setStart(text, Math.min(start, text.textContent!.length));
        range.setEnd(text, Math.min(end, text.textContent!.length));
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      rememberCaret();
      document.addEventListener('selectionchange', rememberCaret);
    },
    setReadOnly(value: boolean) {
      if (editing) editing.element.contentEditable = value ? 'false' : 'true';
    },
  };
}

/** Native selections may be retargeted at shadow hosts. */
export function selectionRange(
  selection: Selection,
  shadowRoots: ShadowRoot[],
) {
  const composed = selection as Selection & {
    getComposedRanges?: (options: {
      shadowRoots: ShadowRoot[];
    }) => StaticRange[];
  };
  const current = composed.getComposedRanges?.({ shadowRoots })[0];
  if (!current) return selection.getRangeAt(0).cloneRange();
  const range = document.createRange();
  range.setStart(current.startContainer, current.startOffset);
  range.setEnd(current.endContainer, current.endOffset);
  return range;
}

export function selectedRun(range: Range) {
  let node = range.startContainer;
  if (node !== range.endContainer) return null;
  if (
    node instanceof Element &&
    node.childNodes.length === 1 &&
    range.startOffset === 0 &&
    range.endOffset === 1
  )
    node = node.firstChild!;
  if (!(node instanceof Text) || !node.parentElement) return null;
  return {
    node,
    start: node === range.startContainer ? range.startOffset : 0,
    end: node === range.endContainer ? range.endOffset : node.length,
  };
}

export function isEditableText(node: Node | null): node is Text {
  if (
    !(node instanceof Text) ||
    !node.data.trim() ||
    node.length > 50000 ||
    !(node.parentElement instanceof HTMLElement)
  )
    return false;
  let el: Element = node.parentElement;
  while (true) {
    if (
      el.closest(
        '[data-humagent-ui],script,style,head,input,textarea,select,option,optgroup,[contenteditable]:not([contenteditable="false"])',
      )
    )
      return false;
    const root = el.getRootNode();
    if (!(root instanceof ShadowRoot)) return true;
    el = root.host;
  }
}
