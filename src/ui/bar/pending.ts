import { createElement } from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';
import type { Plugin } from '../../shared/plugin.js';
import type { BarActions, SavedReviewModel } from '../workspace/model.js';
import { $ } from './controls.js';

const rendered = new WeakMap<HTMLElement, string>();
/** Redraw only on change, and keep keyboard focus on the same pending review control. */
function renderChanged(target: HTMLElement, value: unknown, draw: () => void) {
  const key = JSON.stringify(value);
  if (rendered.get(target) === key) return;
  const active = document.activeElement;
  const focusedId =
    active && target.contains(active)
      ? active.closest<HTMLElement>('[data-review-id]')?.dataset.reviewId
      : undefined;
  const label = active?.getAttribute('aria-label') ?? active?.textContent;
  target.replaceChildren();
  draw();
  rendered.set(target, key);
  if (focusedId) {
    const buttons = [
      ...(target
        .querySelector(`[data-review-id="${CSS.escape(focusedId)}"]`)
        ?.querySelectorAll('button') || []),
    ];
    const next =
      buttons.find(
        (el) =>
          (el.getAttribute('aria-label') ?? el.textContent) === label &&
          !el.disabled,
      ) || buttons.find((el) => !el.disabled);
    next?.focus({ preventScroll: true });
  }
}
/** The pending reviews. Each row opens, highlights, or removes its review. */
function drawPending(
  pending: readonly SavedReviewModel[],
  mutable: boolean,
  plugins: ReadonlyMap<string, Plugin>,
  actions: BarActions,
) {
  pending.forEach(({ saved, stale, unavailable }, index) => {
    const review = saved.review;
    const summary = plugins.get(review.kind)?.summary;
    const li = createElement('li', {
      className: 'review',
      dataset: { reviewId: review.id, stale: String(stale) },
    });
    const content = createElement('div', { className: 'review-content' });
    li.append(content);
    content.append(
      createElement('div', {
        className: 'review-title',
        textContent: summary?.title(saved) ?? review.kind,
      }),
    );
    const body = summary?.body?.(saved);
    if (body) content.append(body);
    if (review.comment)
      content.append(createElement('p', { textContent: review.comment }));
    const status = stale
      ? 'Stale revision. Recreate or remove this review.'
      : unavailable
        ? 'Target unavailable. Inspect or remove this review.'
        : '';
    if (status)
      content.append(
        createElement('p', {
          className: 'review-status',
          textContent: status,
        }),
      );
    if (review.target) {
      const open = createElement('button', {
        className: 'review-open',
        disabled: !mutable || !!status,
        ariaLabel: `Edit review ${index + 1}`,
        ariaHasPopup: 'dialog',
        dataset: { tooltip: status || 'Edit review' },
        onclick() {
          $('frame').focus();
          actions.open(review.id);
        },
      });
      li.prepend(open);
      content.onclick = () => open.click();
      li.onpointerenter = () => actions.highlight(review.id);
      li.onpointerleave = () => actions.highlight();
      li.addEventListener('focusin', () => actions.highlight(review.id));
      li.addEventListener('focusout', (event) => {
        if (
          !li.contains(event.relatedTarget as Node | null) &&
          !li.matches(':hover')
        )
          actions.highlight();
      });
    }
    li.append(
      createElement('button', {
        className: 'review-remove',
        disabled: !mutable,
        ariaLabel: `Delete review ${index + 1}`,
        innerHTML: icon('trash'),
        onclick: () => actions.remove(saved),
      }),
    );
    $('pending').append(li);
  });
}
export function renderPending(...args: Parameters<typeof drawPending>) {
  const [pending, mutable] = args;
  renderChanged($('pending'), [pending, mutable], () => drawPending(...args));
}
