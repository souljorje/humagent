import type { Draft } from '../shared/review.js';

interface Preview {
  draft: Draft;
  node: Text;
  target: Element;
  before: string;
  written: string;
}
interface Editing {
  node: Text;
  element: HTMLSpanElement;
  parent: Node;
  initial: string;
  before: string;
}

/** Own only the selected text node. Restore it only while our editor or preview still owns it. */
export function createTextEditing(hooks: {
  resolve(draft: Draft): Element | null;
  input(): void;
  confirm(): void;
  cancel(): void;
}) {
  const previews = new Map<string, Preview>();
  const unavailable = new Set<string>();
  let editing: Editing | undefined;
  function plainText(node: Node): string {
    if (node instanceof Text) return node.data;
    if (node instanceof HTMLBRElement)
      return node.hasAttribute('data-humagent-placeholder') ? '' : '\n';
    return [...node.childNodes].map(plainText).join('');
  }

  function valid(preview: Preview) {
    return preview.node.isConnected && preview.node.data === preview.written;
  }
  function canonicalText(node: Node): string {
    if (editing?.element === node) return editing.before;
    if (node instanceof Text) {
      for (const preview of previews.values())
        if (preview.node === node && valid(preview)) return preview.before;
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
    const { node, element, parent } = editing;
    // A framework may have replaced the parent or removed the editor.
    if (element.isConnected && element.parentNode === parent)
      element.replaceWith(node);
    editing = undefined;
  }
  function reconcile(drafts: Draft[]) {
    const wanted = new Map(drafts.map((draft) => [draft.item.id, draft]));
    for (const [id, preview] of previews) {
      if (editing?.node === preview.node) continue;
      if (!wanted.has(id)) {
        if (valid(preview)) preview.node.data = preview.before;
        previews.delete(id);
      } else if (!valid(preview) || !hooks.resolve(wanted.get(id)!)) {
        // Never bind the same feedback to a framework's replacement node.
        unavailable.add(id);
        if (valid(preview)) preview.node.data = preview.before;
        previews.delete(id);
      }
    }
    for (const id of unavailable) if (!wanted.has(id)) unavailable.delete(id);
    for (const draft of drafts) {
      const replacement = draft.item.replacement;
      if (!replacement || unavailable.has(draft.item.id)) continue;
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
        unavailable.add(draft.item.id);
        continue;
      }
      previews.set(draft.item.id, {
        draft,
        node,
        target,
        before: replacement.before,
        written: replacement.after,
      });
      if (node.data !== replacement.after) node.data = replacement.after;
    }
  }
  return {
    canonicalText,
    reconcile,
    close,
    unavailable: (id: string) => unavailable.has(id),
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
    get connected() {
      return !!editing?.element.isConnected;
    },
    open(node: Text, start: number, end: number, before: string) {
      close();
      const element = document.createElement('span');
      element.dataset.humagentUi = '';
      element.dataset.humagentText = '';
      element.contentEditable = 'plaintext-only';
      element.setAttribute('role', 'textbox');
      element.setAttribute('aria-label', 'Edit text');
      element.setAttribute('aria-multiline', 'true');
      element.spellcheck = false;
      element.style.cssText =
        'display:inline;white-space:pre-wrap;outline:none;cursor:text;min-width:1ch;';
      element.textContent = node.data;
      if (!node.data) element.style.display = 'inline-block';
      editing = {
        node,
        element,
        parent: node.parentNode!,
        initial: node.data,
        before,
      };
      node.replaceWith(element);
      element.addEventListener('input', (event) => {
        event.stopPropagation();
        element.style.display = element.textContent ? 'inline' : 'inline-block';
        hooks.input();
      });
      element.addEventListener('change', (event) => event.stopPropagation());
      function newline() {
        const selection = getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!element.contains(range.commonAncestorContainer)) return;
        range.deleteContents();
        const line = document.createTextNode('\n');
        range.insertNode(line);
        if (!element.querySelector('[data-humagent-placeholder]')) {
          const end = document.createElement('br');
          end.dataset.humagentPlaceholder = '';
          element.append(end);
        }
        range.setStart(line, 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        hooks.input();
      }
      element.addEventListener('beforeinput', (event) => {
        if (event.isComposing) return;
        if (event.inputType === 'insertLineBreak') {
          event.preventDefault();
          newline();
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
          if (event.shiftKey) newline();
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
    },
    setReadOnly(value: boolean) {
      if (editing)
        editing.element.contentEditable = value ? 'false' : 'plaintext-only';
    },
  };
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
