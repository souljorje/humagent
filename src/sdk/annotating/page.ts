/** What annotating observes on the page and changes in its styles. */
import { effect } from '@/shared/signal';
import './selection.css';

const OBSERVED: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: [
    'class',
    'style',
    'id',
    'data-humagent-id',
    'hidden',
    'role',
    'contenteditable',
    'href',
  ],
};

/** Whether a change is in Humagent's own UI, outside the inline editor. */
const isOwnChange = ({ target }: MutationRecord) =>
  target instanceof Element &&
  !!target.closest('[data-humagent-ui]') &&
  !target.closest('[data-humagent-text]');

/** Call `schedule` after each change that can move a target. */
export function observeLayout(schedule: () => void) {
  document.addEventListener('scroll', schedule, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  const observer = new MutationObserver((records) => {
    if (!records.every(isOwnChange)) schedule();
  });
  observer.observe(document.body || document.documentElement, OBSERVED);
}

/** Mark the page while annotating, so that its text can be selected. */
export function enableTextSelection(enabled: () => boolean) {
  const { documentElement } = document;
  effect(() => {
    documentElement.toggleAttribute('data-humagent-annotating', enabled());
  });
}
