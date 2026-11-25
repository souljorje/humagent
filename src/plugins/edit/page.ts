/** Text edits on the page: what the human can edit, and the open editor. */
import { commentDraft } from '../comment';
import type { Annotating, Editor, Hit, Pick } from '@/sdk/annotating/types';
import { LIMITS, type SavedReview } from '@/shared/feedback';
import type { PageHost, PagePlugin, PluginView } from '@/shared/plugin';
import { editOf, type EditTarget } from './data';
import { createEditor, editorText, selectText, setReadOnly } from './editor';
import {
  createPreviews,
  originalText,
  ownedNode,
  reconcile,
  reviewAt,
  type Editing,
  type Previews,
} from './previews';
import { hitTestText, isEditableText, selectedRun } from './text-hit';

interface State {
  readonly annotating: Annotating;
  readonly previews: Previews;
  view: PluginView;
  editing?: Editing;
}
/** The text that a pick selects for an edit. */
interface Run {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

const caret = (node: Text, offset: number): Run => ({
  node,
  start: offset,
  end: offset,
});

/** Text that shows a sent preview takes no new edit. A pending review's preview takes more edits. */
function canEdit(
  { editing, previews, view }: State,
  node: Node | null,
): node is Text {
  if (!view.writable || !isEditableText(node)) return false;
  const existing = reviewAt(previews, node, editing);
  return (
    !existing ||
    view.pending.some(({ review }) => review.id === existing.review.id)
  );
}

/** A new edit needs a change. A saved edit can return to the original text. */
function buildEdit(
  before: string,
  after: string,
  comment: string,
  saved: SavedReview | undefined,
) {
  if (after.length > LIMITS.text) return undefined;
  if (!saved && after === before) return commentDraft(comment);
  return {
    kind: 'edit',
    ...(comment.trim() ? { comment } : {}),
    data: { before, after },
  };
}

function closeEditor(state: State) {
  if (!state.editing) return;
  const { node, element, parent } = state.editing;
  // A framework may have replaced the parent or removed the editor.
  if (element.isConnected && element.parentNode === parent)
    element.replaceWith(node);
  state.editing = undefined;
}

/** Put an editor in place of a text node. */
function openEditor(
  state: State,
  { node, start, end }: Run,
  before: string,
  saved: SavedReview | undefined,
): Editor {
  closeEditor(state);
  const parent = node.parentElement!;
  const initial = editOf(saved)?.after ?? node.data;
  const textNode = [...parent.childNodes].indexOf(node);
  const target: EditTarget = { textNode, anchor: { quote: before } };
  const element = createEditor(initial, state.annotating);
  node.replaceWith(element);
  state.editing = { node, element, parent, before };
  selectText(element, start, end);
  return {
    target,
    element,
    confirmLabel: 'Confirm text edit',
    changed: () => editorText(element) !== initial,
    setReadOnly: (value) => setReadOnly(element, value),
    close: () => closeEditor(state),
    build: (comment) => buildEdit(before, editorText(element), comment, saved),
  };
}

/** Claim a text, unless it is empty or too long. */
function claim(
  state: State,
  run: Run,
  saved = reviewAt(state.previews, run.node, state.editing),
): Hit | 'blocked' {
  const before = editOf(saved)?.before ?? run.node.data;
  if (!before.trim() || before.length > LIMITS.text) return 'blocked';
  return {
    el: run.node.parentElement!,
    saved,
    open: () => openEditor(state, run, before, saved),
  };
}

function hitSaved(state: State, el: Element, saved: SavedReview) {
  const data = editOf(saved);
  const node = data && ownedNode(state.previews, saved, el, state.editing);
  return node
    ? claim(state, { node, start: 0, end: data.after.length }, saved)
    : 'blocked';
}

function hitRange(state: State, range: Range) {
  const run = selectedRun(range);
  if (!run || !isEditableText(run.node)) return undefined;
  return canEdit(state, run.node) ? claim(state, run) : 'blocked';
}

function hitPoint(state: State, point: NonNullable<Pick['point']>) {
  const found = hitTestText(point, (node) => canEdit(state, node));
  return found && claim(state, caret(found.node, found.offset));
}

/** The keyboard edits an element with one text. */
function hitKeyboard(state: State, el: Element) {
  const [node, ...others] = [...el.childNodes].filter((child) =>
    canEdit(state, child),
  );
  return node && !others.length
    ? claim(state, caret(node, node.length))
    : undefined;
}

function hit(state: State, { el, saved, range, point, keyboard }: Pick) {
  if (saved) return hitSaved(state, el, saved);
  if (range) return hitRange(state, range);
  if (point) return hitPoint(state, point);
  return keyboard ? hitKeyboard(state, el) : undefined;
}

function showPreviews({ annotating, editing, previews, view }: State) {
  reconcile(previews, view.previews, { resolve: annotating.resolve, editing });
}

function present(state: State, view: PluginView) {
  state.view = view;
  showPreviews(state);
}

export function page({ annotating }: PageHost): PagePlugin {
  const state: State = {
    annotating,
    previews: createPreviews(),
    view: { pending: [], previews: [], writable: false },
  };
  return {
    tool: {
      name: 'Text edit',
      hit: (pick) => hit(state, pick),
      textOf: (node) => originalText(state.previews, node, state.editing),
      layout: () => showPreviews(state),
    },
    present: (view) => present(state, view),
  };
}
