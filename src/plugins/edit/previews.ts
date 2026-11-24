/** Text previews on the page. Own only the edited text node. Restore it only while no one else wrote to it. */
import type { SavedReview } from '../../shared/feedback.js';
import { editOf } from './data.js';

interface Preview {
  saved: SavedReview;
  node: Text;
  target: Element;
  before: string;
  written: string;
  /** Counts Humagent's own writes, so any other write proves the application took the text over. */
  observer: MutationObserver;
  writes: number;
  owned: boolean;
}
/** The text node that the inline editor replaces while it is open. */
export interface Editing {
  node: Text;
  element: HTMLElement;
  parent: Node;
  before: string;
}

export function createPreviews(hooks: {
  resolve(saved: SavedReview): Element | null;
  editing(): Editing | undefined;
}) {
  const previews = new Map<string, Preview>();
  const nodes = new WeakMap<Text, Preview>();
  // Pending reviews whose text the application changed. Humagent stops drawing their preview.
  const suppressed = new Set<string>();
  function mutations(
    preview: Preview,
    records = preview.observer.takeRecords(),
  ) {
    const own = Math.min(preview.writes, records.length);
    preview.writes -= own;
    // The application may write the same text after the agent applies the change.
    if (records.length > own) preview.owned = false;
  }
  function valid(preview: Preview) {
    mutations(preview);
    const editing = hooks.editing();
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
  function textNodeAt(saved: SavedReview, target: Element): Text | null {
    const index = saved.review.target?.textNode;
    if (!Number.isInteger(index) || typeof index !== 'number') return null;
    const node = target.childNodes[index];
    return node instanceof Text ? node : null;
  }
  return {
    /** Reopen the text node only while this review still owns its preview. */
    ownedNode(saved: SavedReview, target: Element) {
      const preview = previews.get(saved.review.id);
      return preview?.target === target && valid(preview) ? preview.node : null;
    },
    /** The original text of the open editor or of a previewed text node. */
    textOf(node: Node): string | undefined {
      const editing = hooks.editing();
      if (editing?.element === node) return editing.before;
      if (!(node instanceof Text)) return undefined;
      const preview = nodes.get(node);
      return preview && valid(preview) ? preview.before : undefined;
    },
    /** The pending review whose preview a text node shows. */
    existing(node: Text) {
      return [...previews.values()].find(
        (preview) => preview.node === node && valid(preview),
      )?.saved;
    },
    /** Draw the wanted previews. Remove the others. */
    reconcile(pending: SavedReview[]) {
      const editing = hooks.editing();
      const wanted = new Map(pending.map((saved) => [saved.review.id, saved]));
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
      for (const saved of pending) {
        const edit = editOf(saved);
        if (!edit || suppressed.has(saved.review.id)) continue;
        const previous = previews.get(saved.review.id);
        if (
          editing &&
          (previous?.node === editing.node ||
            (saved.review.target?.textNode !== undefined &&
              hooks.resolve(saved) === editing.parent &&
              editing.parent.childNodes[
                Number(saved.review.target.textNode)
              ] === editing.element))
        )
          continue;
        const target = previous?.target || hooks.resolve(saved);
        if (!target) continue;
        const node = previous?.node || textNodeAt(saved, target);
        if (!node || (!previous && node.data !== edit.before)) {
          suppressed.add(saved.review.id);
          continue;
        }
        const preview: Preview = previous || {
          saved,
          node,
          target,
          before: edit.before,
          written: edit.after,
          observer: new MutationObserver((records) =>
            mutations(preview, records),
          ),
          writes: 0,
          owned: true,
        };
        if (!previous) preview.observer.observe(node, { characterData: true });
        preview.saved = saved;
        preview.written = edit.after;
        previews.set(saved.review.id, preview);
        nodes.set(node, preview);
        if (node.data !== edit.after) {
          preview.writes++;
          node.data = edit.after;
        }
      }
    },
  };
}
