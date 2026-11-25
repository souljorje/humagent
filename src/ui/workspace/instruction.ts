import { errorMessage } from '../../shared/errors.js';
import { signal } from '../../shared/signal.js';

/** The typed instruction. It saves itself shortly after typing stops. */
export function createInstruction(
  save: (text: string) => Promise<unknown>,
  failed: (message: string) => void,
) {
  /** The typed text is not saved yet. */
  const pending = signal(false);
  const status = signal('');
  let text = '',
    /** Counts edits, so an older save cannot confirm newer text. */
    edits = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  /** Save the text now. */
  function flush() {
    clearTimeout(timer);
    const edit = edits;
    return save(text).then(
      () => {
        // A newer edit still needs its own save.
        if (edit !== edits) return;
        pending.set(false);
        status.set('Saved.');
      },
      (e) => {
        status.set('Not saved');
        throw e;
      },
    );
  }
  return {
    pending,
    status,
    flush,
    edit(value: string) {
      text = value;
      edits++;
      clearTimeout(timer);
      timer = setTimeout(() => {
        flush().catch((e) => failed(errorMessage(e)));
      }, 300);
      pending.set(true);
    },
  };
}
