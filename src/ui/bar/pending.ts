/** The pending reviews in the bar. Each row opens, highlights, or removes its review. */
import { createElement } from '@/shared/dom';
import { icon } from '@/shared/icons';
import type { Plugin } from '@/shared/plugin';
import type { BarActions, SavedReviewModel } from '@/ui/workspace/model';
import { $ } from './controls';

interface Row extends SavedReviewModel {
  readonly number: number;
  /** The session accepts input. */
  readonly mutable: boolean;
  /** Why the review cannot open. */
  readonly status: string;
  readonly plugin: Plugin | undefined;
  readonly actions: BarActions;
}
/** A control of a row that has the keyboard focus. */
interface Focused {
  readonly reviewId: string;
  readonly label: string | null | undefined;
}

const rendered = new WeakMap<HTMLElement, string>();

const labelOf = (el: Element | null) =>
  el?.getAttribute('aria-label') ?? el?.textContent;

function focusedIn(target: HTMLElement): Focused | undefined {
  const active = document.activeElement;
  const row = target.contains(active)
    ? active?.closest<HTMLElement>('[data-review-id]')
    : undefined;
  const reviewId = row?.dataset.reviewId;
  return reviewId ? { reviewId, label: labelOf(active) } : undefined;
}

/** Focus the same control of the same review, or another one of its controls. */
function restoreFocus(target: HTMLElement, { reviewId, label }: Focused) {
  const row = target.querySelector(
    `[data-review-id="${CSS.escape(reviewId)}"]`,
  );
  const enabled = [...(row?.querySelectorAll('button') ?? [])].filter(
    (button) => !button.disabled,
  );
  const next = enabled.find((button) => labelOf(button) === label);
  (next ?? enabled[0])?.focus({ preventScroll: true });
}

function statusOf({ stale, unavailable }: SavedReviewModel) {
  if (stale) return 'Stale revision. Recreate or remove this review.';
  return unavailable
    ? 'Target unavailable. Inspect or remove this review.'
    : '';
}

function contentElement({ plugin, saved, status }: Row) {
  const { comment, kind } = saved.review;
  const content = createElement('div', { className: 'review-content' });
  const summary = plugin?.summary?.(saved);
  content.append(
    createElement('div', {
      className: 'review-title',
      textContent: summary?.title ?? kind,
    }),
  );
  if (summary?.body) content.append(summary.body);
  if (comment) content.append(createElement('p', { textContent: comment }));
  if (status)
    content.append(
      createElement('p', { className: 'review-status', textContent: status }),
    );
  return content;
}

function open({ actions, saved }: Row) {
  $('frame').focus();
  actions.open(saved.review.id);
}

function onFocusout(
  li: HTMLElement,
  { relatedTarget }: FocusEvent,
  actions: BarActions,
) {
  if (!li.contains(relatedTarget as Node | null) && !li.matches(':hover'))
    actions.highlight();
}

/** Open the review from its whole row, and highlight its target while the human points at the row or focuses it. */
function makeOpenable(li: HTMLElement, content: HTMLElement, row: Row) {
  const { actions, mutable, number, saved, status } = row;
  const { id } = saved.review;
  const button = createElement('button', {
    className: 'review-open',
    disabled: !mutable || !!status,
    ariaLabel: `Edit review ${number}`,
    ariaHasPopup: 'dialog',
    dataset: { tooltip: status || 'Edit review' },
    onclick: () => open(row),
  });
  li.prepend(button);
  content.onclick = () => button.click();
  li.onpointerenter = () => actions.highlight(id);
  li.onpointerleave = () => actions.highlight();
  li.addEventListener('focusin', () => actions.highlight(id));
  li.addEventListener('focusout', (event) => onFocusout(li, event, actions));
}

function rowElement(row: Row) {
  const { actions, mutable, number, saved, stale } = row;
  const content = contentElement(row);
  const li = createElement('li', {
    className: 'review',
    dataset: { reviewId: saved.review.id, stale: String(stale) },
  });
  li.append(content);
  if (saved.review.target) makeOpenable(li, content, row);
  li.append(
    createElement('button', {
      className: 'review-remove',
      disabled: !mutable,
      ariaLabel: `Delete review ${number}`,
      innerHTML: icon('trash'),
      onclick: () => actions.remove(saved),
    }),
  );
  return li;
}

/** Redraw only on change, and keep keyboard focus on the same pending review control. */
export function renderPending(
  pending: readonly SavedReviewModel[],
  mutable: boolean,
  plugins: ReadonlyMap<string, Plugin>,
  actions: BarActions,
) {
  const list = $('pending');
  const key = JSON.stringify([pending, mutable]);
  if (rendered.get(list) === key) return;
  const focused = focusedIn(list);
  const rows = pending.map((model, index) =>
    rowElement({
      ...model,
      number: index + 1,
      mutable,
      status: statusOf(model),
      plugin: plugins.get(model.saved.review.kind),
      actions,
    }),
  );
  list.replaceChildren(...rows);
  rendered.set(list, key);
  if (focused) restoreFocus(list, focused);
}
