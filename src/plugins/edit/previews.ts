/** Text previews on the page. Own only the edited text node. Restore it only while no one else wrote to it. */
import type { SavedReview } from '@/shared/feedback';
import { textNodeOf, type SavedEdit } from './data';

interface Preview {
  saved: SavedEdit;
  readonly node: Text;
  readonly target: Element;
  readonly before: string;
  written: string;
  /** Sees every write to the node. More writes than Humagent's own prove that the application took the text over. */
  readonly observer: MutationObserver;
  writes: number;
  owned: boolean;
}
/** The text node that the inline editor replaces while it is open. */
export interface Editing {
  readonly node: Text;
  readonly element: HTMLElement;
  readonly parent: Node;
  readonly before: string;
}
export interface Previews {
  readonly byReview: Map<string, Preview>;
  readonly byNode: WeakMap<Text, Preview>;
  /** Pending reviews whose text the application changed. Humagent stops drawing their preview. */
  readonly suppressed: Set<string>;
}
/** What previews read from the page. */
export interface PageState {
  resolve(saved: SavedReview): Element | null;
  readonly editing?: Editing;
}

export const createPreviews = (): Previews => ({
  byReview: new Map(),
  byNode: new WeakMap(),
  suppressed: new Set(),
});

function recordWrites(preview: Preview, records: readonly MutationRecord[]) {
  const own = Math.min(preview.writes, records.length);
  preview.writes -= own;
  // The application may write the same text after the agent applies the change.
  if (records.length > own) preview.owned = false;
}

/** Whether Humagent still owns the previewed text, or the open editor stands there for it. */
function valid(preview: Preview, editing: Editing | undefined) {
  recordWrites(preview, preview.observer.takeRecords());
  const { node, owned, target, written } = preview;
  const inPage = node.isConnected && node.parentNode === target;
  const inEditor =
    editing?.node === node && editing.element.parentNode === target;
  return owned && (inPage || inEditor) && node.data === written;
}

function textNodeAt(saved: SavedEdit, target: Element): Text | null {
  const index = textNodeOf(saved);
  if (index === undefined || !Number.isInteger(index)) return null;
  const node = target.childNodes[index];
  return node instanceof Text ? node : null;
}

/** Whether the open editor edits the text of a review. */
function inEditor(
  saved: SavedEdit,
  preview: Preview | undefined,
  { editing, resolve }: PageState,
) {
  if (!editing) return false;
  if (preview?.node === editing.node) return true;
  const index = textNodeOf(saved);
  return (
    index !== undefined &&
    resolve(saved) === editing.parent &&
    editing.parent.childNodes[index] === editing.element
  );
}

function createPreview(saved: SavedEdit, node: Text, target: Element): Preview {
  const { before, after } = saved.review.data;
  const preview: Preview = {
    saved,
    node,
    target,
    before,
    written: after,
    observer: new MutationObserver((records) => recordWrites(preview, records)),
    writes: 0,
    owned: true,
  };
  preview.observer.observe(node, { characterData: true });
  return preview;
}

/** Show the text of a review in its preview. */
function write(preview: Preview, saved: SavedEdit) {
  const { after } = saved.review.data;
  preview.saved = saved;
  preview.written = after;
  if (preview.node.data === after) return;
  preview.writes++;
  preview.node.data = after;
}

function draw(previews: Previews, saved: SavedEdit, page: PageState) {
  const { byNode, byReview, suppressed } = previews;
  const { id } = saved.review;
  const edit = saved.review.data;
  if (suppressed.has(id)) return;
  const previous = byReview.get(id);
  if (inEditor(saved, previous, page)) return;
  const target = previous?.target ?? page.resolve(saved);
  if (!target) return;
  const node = previous?.node ?? textNodeAt(saved, target);
  if (!node || (!previous && node.data !== edit.before)) {
    suppressed.add(id);
    return;
  }
  const preview = previous ?? createPreview(saved, node, target);
  write(preview, saved);
  byReview.set(id, preview);
  byNode.set(node, preview);
}

/** Draw the wanted previews. Remove the others. */
export function reconcile(
  previews: Previews,
  shown: readonly SavedEdit[],
  page: PageState,
) {
  const wanted = new Map(shown.map((saved) => [saved.review.id, saved]));
  const { byNode, byReview, suppressed } = previews;
  for (const [id, preview] of byReview) {
    const { node, observer, target } = preview;
    if (page.editing?.node === node) continue;
    const saved = wanted.get(id);
    const owned = valid(preview, page.editing);
    if (saved && owned && page.resolve(saved) === target) continue;
    // The application changed this target. Keep the feedback attached.
    if (saved) suppressed.add(id);
    if (owned) node.data = preview.before;
    observer.disconnect();
    byNode.delete(node);
    byReview.delete(id);
  }
  for (const id of suppressed) if (!wanted.has(id)) suppressed.delete(id);
  for (const saved of shown) draw(previews, saved, page);
}

/** Reopen the text node only while this review still owns its preview. */
export function ownedPreview(
  previews: Previews,
  saved: SavedReview,
  target: Element,
  editing: Editing | undefined,
) {
  const preview = previews.byReview.get(saved.review.id);
  return preview?.target === target && valid(preview, editing) ? preview : null;
}

function validAt(
  { byNode }: Previews,
  node: Text,
  editing: Editing | undefined,
) {
  const preview = byNode.get(node);
  return preview && valid(preview, editing) ? preview : undefined;
}

/** The review whose preview a text node shows. */
export const reviewAt = (
  previews: Previews,
  node: Text,
  editing: Editing | undefined,
) => validAt(previews, node, editing)?.saved;

/** The original text of the open editor or of a previewed text node. */
export function originalText(
  previews: Previews,
  node: Node,
  editing: Editing | undefined,
): string | undefined {
  if (editing?.element === node) return editing.before;
  return node instanceof Text
    ? validAt(previews, node, editing)?.before
    : undefined;
}
