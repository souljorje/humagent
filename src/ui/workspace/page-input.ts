/** Input on the attached page that the server does not hold yet. */
import type { Unsaved } from '@/shared/feedback';
import { signal, type Signal } from '@/shared/signal';

/** A page that went away never reports that it saved, so the wait is limited. */
const SAVE_LIMIT = 5000;

export interface PageInput {
  /** The open editor has unfinished input. */
  readonly editorDirty: Signal<boolean>;
  /** The state of plugin input. */
  readonly unsaved: Signal<Unsaved | null>;
  /** Ends the wait for the page. */
  resume?: () => void;
}

export const createPageInput = (): PageInput => ({
  editorDirty: signal(false),
  unsaved: signal<Unsaved | null>(null),
});

export function reportInput(input: PageInput, state: Unsaved | null) {
  input.unsaved.set(state);
  if (state !== 'saving') input.resume?.();
}

/** A new page document starts without input. */
export function resetInput(input: PageInput) {
  input.editorDirty.set(false);
  reportInput(input, null);
}

/** Wait until the page stops saving. */
export async function inputSettled(input: PageInput) {
  if (input.unsaved() !== 'saving') return;
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, SAVE_LIMIT);
  input.resume = resolve;
  await promise;
  clearTimeout(timer);
  input.resume = undefined;
}
