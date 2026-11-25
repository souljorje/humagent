/** What annotating observes on the page and changes in its styles. */
import { effect } from '../../shared/signal.js';

/** Call `schedule` after each change that can move a target. */
export function observeLayout(schedule: () => void) {
  document.addEventListener('scroll', schedule, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  const observer = new MutationObserver((records) => {
    if (
      records.every(
        (record) =>
          record.target instanceof Element &&
          record.target.closest('[data-humagent-ui]') &&
          !record.target.closest('[data-humagent-text]'),
      )
    )
      return;
    schedule();
  });
  observer.observe(document.body || document.documentElement, {
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
  });
}

export function enableTextSelection(enabled: () => boolean) {
  const selectionStyle = new CSSStyleSheet();
  selectionStyle.replaceSync(
    '*:not([data-humagent-ui],input,textarea,select,option){user-select:text!important;-webkit-user-select:text!important}',
  );
  // Pages can block text selection with CSS. Selection must work while annotating.
  effect(() => {
    const active = enabled();
    const sheets = document.adoptedStyleSheets;
    if (active === sheets.includes(selectionStyle)) return;
    document.adoptedStyleSheets = active
      ? [...sheets, selectionStyle]
      : sheets.filter((sheet) => sheet !== selectionStyle);
  });
}
