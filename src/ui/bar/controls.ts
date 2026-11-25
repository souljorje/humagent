/** Every element of `index.html` that the bar uses. */
interface Controls {
  frame: HTMLIFrameElement;
  connecting: HTMLElement;
  bar: HTMLElement;
  error: HTMLElement;
  update: HTMLElement;
  'reload-page': HTMLButtonElement;
  details: HTMLElement;
  'agent-indicator': HTMLElement;
  'agent-state': HTMLElement;
  'agent-hint': HTMLElement;
  end: HTMLButtonElement;
  'pending-count': HTMLElement;
  pending: HTMLOListElement;
  'bar-toggle': HTMLButtonElement;
  'toggle-icon': HTMLElement;
  'toggle-dot': HTMLElement;
  'toggle-count': HTMLElement;
  instruction: HTMLTextAreaElement;
  send: HTMLButtonElement;
  'bridge-status': HTMLElement;
  'instruction-status': HTMLElement;
}
export const $ = <K extends keyof Controls>(name: K) =>
  document.getElementById(name) as unknown as Controls[K];
