/** Whether the human annotates. */
import { closeCapture, pressOutside } from './capture';
import { startCursor } from './cursor';
import { schedule } from './placement';
import { render } from './render';
import { isEnabled, type Annotator } from './state';

function confirmMode(a: Annotator) {
  a.bridge.post('annotating', { enabled: isEnabled(a) });
}

/** Change the mode. Unfinished input keeps it. */
export function setMode(a: Annotator, value: boolean, keyboard = false) {
  if (pressOutside(a)) {
    confirmMode(a);
    return;
  }
  closeCapture(a);
  a.annotating.set(value);
  confirmMode(a);
  startCursor(a, isEnabled(a) && keyboard);
  render(a);
  schedule(a);
}
