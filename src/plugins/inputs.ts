/** Page inputs are independent of the workspace's review kinds. */
import type { Annotating } from '@/sdk/annotating/types';
import type { Presentation } from '@/shared/bridge';
import type { SavedReview } from '@/shared/feedback';
import { savedEdits, type SavedEdit } from './edit/data';
import { textPicker } from './edit/page';
import { attachForms, type FormHost } from './form/page';

export interface PageView {
  readonly pending: readonly SavedReview[];
  readonly edits: readonly SavedEdit[];
  readonly writable: boolean;
}

export const pageView = (
  revision: string,
  { pending, previews, writable }: Omit<Presentation, 'bar'> = {
    pending: [],
    previews: [],
    writable: false,
  },
): PageView => ({
  pending: pending.filter((saved) => saved.revision === revision),
  edits: savedEdits(previews),
  writable,
});

export function pageInputs(
  annotating: Annotating,
  view: () => PageView,
  host: FormHost,
) {
  const forms = attachForms(host);
  return {
    pickers: [textPicker(annotating, view)],
    api: Object.freeze({ submit: forms.submit }),
    restore: () => forms.restore(view().pending),
    discard(saved: SavedReview) {
      if (saved.review.kind === 'form') forms.discard(saved);
    },
  };
}

declare global {
  interface Window {
    humagent: ReturnType<typeof pageInputs>['api'];
  }
}
