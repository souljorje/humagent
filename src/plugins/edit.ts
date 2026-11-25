/** Text edits: an inline editor for one text node, previews of saved edits, and a diff in the bar. */
import { LIMITS, type SavedReview } from '../shared/feedback.js';
import type {
  Plugin,
  Hit,
  PageHost,
  PagePlugin,
  ReviewSummary,
} from '../shared/plugin.js';
import { createElement } from '../shared/dom.js';
import { ensure, object, text } from '../shared/validate.js';
import { editOf, type EditData, type EditTarget } from './edit/data.js';
import { createEditor } from './edit/editor.js';
import { createPreviews, type Editing } from './edit/previews.js';
import { textDiff } from './edit/text-diff.js';
import { hitTestText, isEditableText, selectedRun } from './edit/text-hit.js';

function page(host: PageHost): PagePlugin {
  const { annotating } = host;
  let pending: SavedReview[] = [],
    shown: SavedReview[] = [],
    writable = false;
  let editing: Editing | undefined;
  const previews = createPreviews({
    resolve: annotating.resolve,
    editing: () => editing,
  });
  /** Text that shows a sent preview takes no new edit. A pending review's preview takes more edits. */
  function canEdit(node: Node | null): node is Text {
    if (!writable || !isEditableText(node)) return false;
    const existing = previews.existing(node);
    return (
      !existing ||
      pending.some((saved) => saved.review.id === existing.review.id)
    );
  }
  function claim(
    node: Text,
    start: number,
    end: number,
    saved = previews.existing(node),
  ): Hit | 'blocked' {
    const before = editOf(saved)?.before ?? node.data;
    if (!before.trim() || before.length > LIMITS.text) return 'blocked';
    const el = node.parentElement!;
    return {
      el,
      saved,
      open() {
        close();
        const initial = editOf(saved)?.after ?? node.data;
        const view = createEditor(initial, annotating);
        const textNode = [...el.childNodes].indexOf(node);
        editing = { node, element: view.element, parent: el, before };
        node.replaceWith(view.element);
        view.select(start, end);
        return {
          target: { textNode, anchor: { quote: before } } as EditTarget,
          element: view.element,
          confirmLabel: 'Confirm text edit',
          changed: () => view.value() !== initial,
          valid: () => view.value().length <= LIMITS.text,
          setReadOnly: view.setReadOnly,
          close,
          build(comment) {
            const after = view.value();
            // A new edit needs a change. A saved edit can return to the original text.
            if (!saved && after === before) return undefined;
            return {
              ...(comment.trim() ? { comment } : {}),
              data: { before, after },
            };
          },
        };
      },
    };
  }
  function close() {
    if (!editing) return;
    const { node, element, parent } = editing;
    // A framework may have replaced the parent or removed the editor.
    if (element.isConnected && element.parentNode === parent)
      element.replaceWith(node);
    editing = undefined;
  }
  return {
    tool: {
      name: 'Text edit',
      hit(pick) {
        if (pick.saved) {
          const data = editOf(pick.saved);
          const node = data && previews.ownedNode(pick.saved, pick.el);
          return node
            ? claim(node, 0, data.after.length, pick.saved)
            : 'blocked';
        }
        if (pick.range) {
          const run = selectedRun(pick.range);
          if (!run || !isEditableText(run.node)) return undefined;
          return canEdit(run.node)
            ? claim(run.node, run.start, run.end)
            : 'blocked';
        }
        if (pick.point) {
          const found = hitTestText(pick.point, canEdit);
          return found && claim(found.node, found.offset, found.offset);
        }
        if (pick.keyboard) {
          const nodes = [...pick.el.childNodes].filter(canEdit);
          return nodes.length === 1
            ? claim(nodes[0]!, nodes[0]!.length, nodes[0]!.length)
            : undefined;
        }
        return undefined;
      },
      textOf: previews.textOf,
      layout: () => previews.reconcile(shown),
    },
    present(view) {
      pending = view.pending;
      shown = view.previews;
      writable = view.writable;
      previews.reconcile(shown);
    },
  };
}

const DIFF_TAG = { remove: 'del', add: 'ins', same: 'span' } as const;
const summary: ReviewSummary = {
  title: () => 'Text edit',
  body(saved) {
    const data = editOf(saved);
    if (!data) return;
    const diff = createElement('p', {
      className: 'edit',
      role: 'group',
      ariaLabel: 'Text changes',
    });
    for (const part of textDiff(data.before, data.after))
      diff.append(
        createElement(DIFF_TAG[part.kind], { textContent: part.text }),
      );
    return diff;
  },
  // The diff scrolls on its own. A click on it opens the editor like the rest of the row.
  styles: `
    .review .edit {
      --ha-bg-edit-insert: color-mix(in srgb, var(--ha-white) calc(18 * 100% / 255), transparent);
      pointer-events: auto;
      margin: var(--ha-spacing-1-5) 0 0;
      font-size: var(--ha-text-label);
      line-height: 1.6;
      white-space: normal;
      overflow-wrap: anywhere;
      max-height: 100px;
      overflow: auto;
    }
    .review:has(.review-open:not(:disabled)) .edit{cursor:pointer}
    .edit span,.edit del{color:var(--ha-fg-muted)}
    .edit ins{text-decoration:none;background:var(--ha-bg-edit-insert);border-radius:3px;box-decoration-break:clone}
    .edit del+ins{margin-inline-start:.25em}
  `,
};

export const edit: Plugin = {
  kind: 'edit',
  // Repeated edits keep the original text.
  contract: {
    validateReview({ data, target }, previous) {
      ensure(target, 'An edit review requires a target');
      object(data, 'Edit');
      const saved = previous?.data as EditData | undefined;
      return {
        before: saved
          ? saved.before
          : text(data.before, 'Edit before', LIMITS.text),
        after: text(data.after, 'Edit after', LIMITS.text, true),
      };
    },
  },
  page,
  summary,
};
