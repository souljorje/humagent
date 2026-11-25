/** Keyboard input on the page. Arrow keys move a cursor over the elements that a review can target. */
import { isTarget } from '../targets.js';
import type { CaptureState } from './capture.js';
import type { Picking } from './picking.js';

const HINT = 'Arrow keys choose an element. Enter comments. Escape exits.';
interface Hooks {
  enabled(): boolean;
  setMode(value: boolean, keyboard?: boolean): void;
  hover(el?: Element): void;
  hovered(): Element | undefined;
  render(): void;
  schedule(): void;
}

export function installKeyboard(
  capture: CaptureState,
  picking: Picking,
  hooks: Hooks,
) {
  let candidates: Element[] = [],
    cursor = -1;
  let hint: string | undefined,
    hintText = HINT;
  function cursorAt(offset: number) {
    if (!candidates.length) return;
    cursor = (cursor + offset + candidates.length) % candidates.length;
    const el = candidates[cursor];
    hooks.hover(el);
    el?.scrollIntoView({ block: 'nearest' });
    hintText = `Element ${cursor + 1} of ${candidates.length}. Arrow keys move. Enter opens a review. Escape exits.`;
    if (hint !== undefined) hint = hintText;
    hooks.render();
    hooks.schedule();
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      if (capture.current()) {
        event.preventDefault();
        capture.close();
      } else if (hooks.enabled()) {
        event.preventDefault();
        hooks.setMode(false);
      }
      return;
    }
    if (!hooks.enabled() || capture.current() || !isTarget(event.target))
      return;
    if (
      ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)
    ) {
      event.preventDefault();
      if (!candidates.length) hooks.setMode(true, true);
      else cursorAt(['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1);
      hint = hintText;
      hooks.render();
    } else if (event.key === 'Enter') {
      const el = hooks.hovered();
      if (!el) return;
      event.preventDefault();
      picking.pick({ el, keyboard: true });
    }
  }
  document.addEventListener('keydown', keydown, true);
  return {
    /** The shown hint, or nothing while it is hidden. */
    hint: () => hint,
    /** Follow a mode change. The keyboard starts at the first element. */
    start(keyboard: boolean) {
      hint = keyboard ? hintText : undefined;
      if (!keyboard) return;
      candidates = [
        ...document.querySelectorAll(
          'h1,h2,h3,h4,p,li,td,th,img,a,button,input,select,textarea,label,[data-humagent-id],[role]',
        ),
      ]
        .filter((el) => isTarget(el) && el.getClientRects().length)
        .slice(0, 2000);
      cursor = -1;
      cursorAt(1);
    },
  };
}
