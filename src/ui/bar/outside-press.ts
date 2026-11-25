/** Guard unfinished page input against presses in the workspace. */
interface Guard {
  readonly dirty: () => boolean;
  readonly outside: () => void;
  /** The last press was taken, so its click is taken too. */
  blockedClick: boolean;
}

function take(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function onPress(guard: Guard, event: Event) {
  guard.blockedClick = guard.dirty();
  if (!guard.blockedClick) return;
  take(event);
  guard.outside();
}

function onClick(guard: Guard, event: Event) {
  if (!guard.blockedClick && !guard.dirty()) return;
  take(event);
  if (!guard.blockedClick) guard.outside();
  guard.blockedClick = false;
}

/** While the page has unfinished input, the first outside press refocuses it instead of acting. */
export function guardOutsidePress(dirty: () => boolean, outside: () => void) {
  const guard: Guard = { dirty, outside, blockedClick: false };
  document.addEventListener('pointerdown', (e) => onPress(guard, e), true);
  document.addEventListener('click', (e) => onClick(guard, e), true);
  document.addEventListener('keydown', () => {
    guard.blockedClick = false;
  });
}
