/** Guard unfinished page input against presses in the workspace. */
export function guardOutsidePress(dirty: () => boolean, outside: () => void) {
  // While the page has unfinished input, the first outside press refocuses it instead of acting.
  let blockedClick = false;
  document.addEventListener(
    'pointerdown',
    (event) => {
      blockedClick = dirty();
      if (!blockedClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      outside();
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (!blockedClick && !dirty()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!blockedClick) outside();
      blockedClick = false;
    },
    true,
  );
  document.addEventListener('keydown', () => {
    blockedClick = false;
  });
}
