import { materialStyles } from './material-styles.js';

/** Tooltips stay outside clipped panels. Disabled buttons retain a keyboard focus target. */
export function installTooltips(root: Document | ShadowRoot) {
  const container = root instanceof Document ? root.body : root;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    ${materialStyles}
    .tooltip-anchor{display:inline-flex;flex-shrink:0;border-radius:18px}
    .tooltip-anchor[hidden]{display:none!important}
    .tooltip-anchor:focus-visible{outline:2px solid #eee;outline-offset:2px}
    .control-tooltip{position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;width:max-content;max-width:calc(100vw - 24px);padding:6px 9px;border:0;border-radius:8px;--glass-fill:rgb(24 24 27 / 90%);color:#f5f5f5;font:12px/1.4 system-ui,sans-serif;overflow-wrap:anywhere;transition:opacity 120ms,translate 120ms,display 120ms allow-discrete}
    .control-tooltip[hidden]{display:none;opacity:0;translate:0 3px}
    @starting-style{.control-tooltip:not([hidden]){opacity:0;translate:0 3px}}
    @media(prefers-reduced-motion:reduce){.control-tooltip{transition:none}}
  `);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  const tooltip = document.createElement('div');
  tooltip.className = 'control-tooltip glass-surface';
  tooltip.id = `tooltip-${crypto.randomUUID()}`;
  tooltip.role = 'tooltip';
  tooltip.hidden = true;
  container.append(tooltip);
  let active: HTMLElement | null = null;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout>;
  const label = (el: HTMLElement) =>
    el.dataset.tooltip || el.getAttribute('aria-label') || el.textContent || '';
  function hide() {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    active?.removeAttribute('aria-describedby');
    active = null;
    tooltip.hidden = true;
  }
  function position() {
    if (!active || tooltip.hidden) return;
    const rect = active.getBoundingClientRect();
    if (!active.isConnected || !rect.width || !rect.height) return hide();
    const box = tooltip.getBoundingClientRect();
    const left = `${Math.max(12, Math.min(rect.left + (rect.width - box.width) / 2, innerWidth - box.width - 12))}px`;
    const top = `${Math.max(12, Math.min(rect.top - box.height - 8 >= 12 ? rect.top - box.height - 8 : rect.bottom + 8, innerHeight - box.height - 12))}px`;
    if (tooltip.style.left !== left) tooltip.style.left = left;
    if (tooltip.style.top !== top) tooltip.style.top = top;
    frame = requestAnimationFrame(position);
  }
  function show(el: HTMLElement, delay = 0) {
    if (active === el && !tooltip.hidden) return;
    hide();
    active = el;
    timer = setTimeout(() => {
      if (!el.isConnected || !el.getClientRects().length) return hide();
      tooltip.textContent = label(el);
      tooltip.hidden = false;
      el.setAttribute('aria-describedby', tooltip.id);
      position();
    }, delay);
  }
  function control(event: Event) {
    return event
      .composedPath()
      .find(
        (el) =>
          el instanceof HTMLElement &&
          (el.matches('button,[data-tooltip]') ||
            el.classList.contains('tooltip-anchor')),
      ) as HTMLElement | undefined;
  }
  root.addEventListener('pointerover', (event) => {
    const el = control(event);
    if (el) show(el, 250);
  });
  root.addEventListener('pointerout', () => {
    if (
      active &&
      (active === root.activeElement || active.contains(root.activeElement))
    )
      return;
    hide();
  });
  root.addEventListener('focusin', (event) => {
    const el = control(event);
    if (el) show(el);
  });
  root.addEventListener('focusout', hide);
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('keydown', hide, true);
  root.addEventListener('scroll', hide, true);
  function prepare(button: HTMLButtonElement) {
    if (button.classList.contains('marker')) return;
    let wrapper = button.parentElement!;
    if (!wrapper.classList.contains('tooltip-anchor')) {
      wrapper = document.createElement('span');
      wrapper.className = 'tooltip-anchor';
      button.before(wrapper);
      wrapper.append(button);
    }
    wrapper.hidden = button.hidden;
    wrapper.tabIndex = button.disabled ? 0 : -1;
    const text = label(button);
    if (wrapper.getAttribute('aria-label') !== text)
      wrapper.setAttribute('aria-label', text);
    if (wrapper.dataset.tooltip !== text) wrapper.dataset.tooltip = text;
  }
  function collect(node: Node, buttons: Set<HTMLButtonElement>) {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLButtonElement) buttons.add(node);
    for (const button of node.querySelectorAll<HTMLButtonElement>(
      'button:not(.marker)',
    ))
      buttons.add(button);
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    'button:not(.marker)',
  ))
    prepare(button);
  new MutationObserver((records) => {
    const buttons = new Set<HTMLButtonElement>();
    for (const record of records) {
      if (record.target === tooltip) continue;
      if (record.target instanceof Element) {
        const button = record.target.closest('button');
        if (button) buttons.add(button);
      }
      for (const node of record.addedNodes) collect(node, buttons);
    }
    for (const button of buttons) if (button.isConnected) prepare(button);
    if (active && !tooltip.hidden && tooltip.textContent !== label(active))
      tooltip.textContent = label(active);
  }).observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'hidden', 'aria-label', 'data-tooltip'],
  });
}
