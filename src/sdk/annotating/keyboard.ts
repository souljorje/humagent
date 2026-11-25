/** Keyboard input on the page. Arrow keys move a cursor over the elements that a review can target. */
import { isTarget } from '@/sdk/targets';
import { closeCapture } from './capture';
import { moveCursor, showHint } from './cursor';
import { setMode } from './mode';
import { pick } from './picking';
import { isEnabled, type Annotator } from './state';

/** The direction of each arrow key. */
const ARROWS: ReadonlyMap<string, number> = new Map([
  ['ArrowDown', 1],
  ['ArrowRight', 1],
  ['ArrowUp', -1],
  ['ArrowLeft', -1],
]);

function onEscape(a: Annotator, event: KeyboardEvent) {
  const open = !!a.capture.current;
  if (!open && !isEnabled(a)) return;
  event.preventDefault();
  if (open) closeCapture(a);
  else setMode(a, false);
}

function onKeydown(a: Annotator, event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') return onEscape(a, event);
  if (!isEnabled(a) || a.capture.current || !isTarget(event.target)) return;
  const offset = ARROWS.get(event.key);
  const el = a.placement.hovered;
  if (offset !== undefined) {
    event.preventDefault();
    // The first arrow key starts the cursor.
    if (a.cursor.candidates.length) moveCursor(a, offset);
    else setMode(a, true, true);
    showHint(a);
  } else if (event.key === 'Enter' && el) {
    event.preventDefault();
    pick(a, { el, keyboard: true });
  }
}

export function listenKeyboard(a: Annotator) {
  document.addEventListener('keydown', (event) => onKeydown(a, event), true);
}
