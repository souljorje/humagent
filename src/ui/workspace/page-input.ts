import type { Unsaved } from '../../shared/feedback.js';
import { signal } from '../../shared/signal.js';

/** Input on the attached page that the server does not hold yet. */
export function createPageInput() {
  /** The open editor has unfinished input. */
  const editorDirty = signal(false);
  /** The state of plugin input. */
  const unsaved = signal<Unsaved | null>(null);
  let resume: (() => void) | undefined;
  function report(state: Unsaved | null) {
    unsaved.set(state);
    if (state !== 'saving') resume?.();
  }
  return {
    editorDirty,
    unsaved,
    report,
    /** A new page document starts without input. */
    reset() {
      editorDirty.set(false);
      report(null);
    },
    /** Wait until the page stops saving. A page that went away never reports it, so the wait is limited. */
    async settled() {
      if (unsaved() !== 'saving') return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await new Promise<void>((resolve) => {
        resume = resolve;
        timer = setTimeout(resolve, 5000);
      });
      clearTimeout(timer);
      resume = undefined;
    },
  };
}
