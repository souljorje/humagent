/** Helpers for rendering code, which builds Humagent's own DOM. */

/** Create an HTML element with optional DOM properties. */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  { dataset, ...properties }: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (dataset) Object.assign(element.dataset, dataset);
  return Object.assign(element, properties);
}
/** Write text only when it changes, so live regions do not announce it again. */
export function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}
/** Fit a text field's height to its text, up to a limit in pixels. */
export function autosize(field: HTMLTextAreaElement, limit = 136) {
  field.style.height = 'auto';
  field.style.height = `${Math.min(limit, field.scrollHeight)}px`;
}
/** Where a press landed, in viewport pixels. A keyboard activation has no position. */
export function clickPoint(
  event: MouseEvent,
): { x: number; y: number } | undefined {
  return (event.isTrusted && event.detail > 0) || event.clientX || event.clientY
    ? { x: event.clientX, y: event.clientY }
    : undefined;
}
