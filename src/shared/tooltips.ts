import { createElement } from './dom';

type Root = Document | ShadowRoot;
interface Tooltip {
  readonly root: Root;
  readonly element: HTMLElement;
  /** The element that the tooltip describes. */
  active: HTMLElement | null;
  timer?: ReturnType<typeof setTimeout>;
}

const MARGIN = 12;
const GAP = 8;
const HOVER_DELAY = 250;
const OBSERVED: MutationObserverInit = {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['disabled', 'hidden', 'aria-label', 'data-tooltip'],
};

const labelOf = (el: HTMLElement) =>
  el.dataset.tooltip || el.getAttribute('aria-label') || el.textContent || '';

const controlOf = (event: Event) =>
  event
    .composedPath()
    .find(
      (target): target is HTMLElement =>
        target instanceof HTMLElement &&
        target.matches('button,[data-tooltip],.tooltip-anchor'),
    );

const within = (value: number, size: number, limit: number) =>
  Math.max(MARGIN, Math.min(value, limit - size - MARGIN));

function setPixels(el: HTMLElement, side: 'left' | 'top', value: number) {
  const pixels = `${value}px`;
  if (el.style[side] !== pixels) el.style[side] = pixels;
}

/** Above its target, or below it when there is no room. */
function place(element: HTMLElement, target: DOMRect) {
  const box = element.getBoundingClientRect();
  const left = target.left + (target.width - box.width) / 2;
  const above = target.top - box.height - GAP;
  const top = above >= MARGIN ? above : target.bottom + GAP;
  setPixels(element, 'left', within(left, box.width, innerWidth));
  setPixels(element, 'top', within(top, box.height, innerHeight));
}

function hide(tooltip: Tooltip) {
  clearTimeout(tooltip.timer);
  tooltip.active?.removeAttribute('aria-describedby');
  tooltip.active = null;
  tooltip.element.hidden = true;
}

function position(tooltip: Tooltip) {
  const { active, element } = tooltip;
  if (!active || element.hidden) return;
  const rect = active.getBoundingClientRect();
  if (active.isConnected && rect.width && rect.height) place(element, rect);
  else hide(tooltip);
}

function describe(tooltip: Tooltip, el: HTMLElement) {
  if (!el.isConnected || !el.getClientRects().length) return hide(tooltip);
  tooltip.element.textContent = labelOf(el);
  tooltip.element.hidden = false;
  el.setAttribute('aria-describedby', tooltip.element.id);
  position(tooltip);
}

function show(tooltip: Tooltip, el: HTMLElement | undefined, delay = 0) {
  if (!el || (tooltip.active === el && !tooltip.element.hidden)) return;
  hide(tooltip);
  tooltip.active = el;
  tooltip.timer = setTimeout(() => describe(tooltip, el), delay);
}

/** The keyboard focus keeps the tooltip. */
function onPointerout(tooltip: Tooltip) {
  const { activeElement } = tooltip.root;
  if (!tooltip.active?.contains(activeElement)) hide(tooltip);
}

/** Disabled buttons retain a keyboard focus target. */
function wrap(button: HTMLButtonElement) {
  const parent = button.parentElement!;
  if (parent.classList.contains('tooltip-anchor')) return parent;
  const wrapper = createElement('span', { className: 'tooltip-anchor' });
  button.before(wrapper);
  wrapper.append(button);
  return wrapper;
}

function prepare(button: HTMLButtonElement) {
  if (button.classList.contains('marker')) return;
  const wrapper = wrap(button);
  const label = labelOf(button);
  wrapper.hidden = button.hidden;
  wrapper.tabIndex = button.disabled ? 0 : -1;
  if (wrapper.getAttribute('aria-label') !== label)
    wrapper.setAttribute('aria-label', label);
  if (wrapper.dataset.tooltip !== label) wrapper.dataset.tooltip = label;
}

const isButton = (node: Node | null): node is HTMLButtonElement =>
  node instanceof HTMLButtonElement;

/** The buttons of an added node. */
const buttonsIn = (node: Node) =>
  node instanceof Element
    ? [node, ...node.querySelectorAll('button')].filter(isButton)
    : [];

/** The buttons that a change concerns. */
function buttonsOf({ target, addedNodes }: MutationRecord) {
  const changed = target instanceof Element ? target.closest('button') : null;
  return [changed, ...Array.from(addedNodes, buttonsIn).flat()].filter(
    isButton,
  );
}

function onMutations(tooltip: Tooltip, records: MutationRecord[]) {
  const { active, element } = tooltip;
  const changes = records.filter(({ target }) => target !== element);
  for (const button of new Set(changes.flatMap(buttonsOf)))
    if (button.isConnected) prepare(button);
  // The label can change while the tooltip is open.
  if (active && !element.hidden && element.textContent !== labelOf(active)) {
    element.textContent = labelOf(active);
    position(tooltip);
  }
}

function listen(tooltip: Tooltip) {
  const { root } = tooltip;
  root.addEventListener('pointerover', (event) =>
    show(tooltip, controlOf(event), HOVER_DELAY),
  );
  root.addEventListener('pointerout', () => onPointerout(tooltip));
  root.addEventListener('focusin', (event) => show(tooltip, controlOf(event)));
  root.addEventListener('focusout', () => hide(tooltip));
  for (const type of ['pointerdown', 'keydown', 'scroll'])
    root.addEventListener(type, () => hide(tooltip), true);
  addEventListener('resize', () => position(tooltip));
}

/** Tooltips stay outside clipped panels. */
export function installTooltips(root: Root) {
  const tooltip: Tooltip = {
    root,
    element: createElement('div', {
      className: 'control-tooltip glass-surface',
      id: `tooltip-${crypto.randomUUID()}`,
      role: 'tooltip',
      hidden: true,
    }),
    active: null,
  };
  const container = root instanceof Document ? root.body : root;
  container.append(tooltip.element);
  listen(tooltip);
  root
    .querySelectorAll<HTMLButtonElement>('button:not(.marker)')
    .forEach(prepare);
  new MutationObserver((records) => onMutations(tooltip, records)).observe(
    root,
    OBSERVED,
  );
}
