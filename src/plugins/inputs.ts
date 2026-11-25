/** Page inputs are independent of the workspace's review kinds. */
import type { Annotating } from '@/sdk/annotating/types';
import type { Presentation } from '@/shared/bridge';
import type { SavedReview } from '@/shared/feedback';
import { textTool } from './edit/page';
import { attachForms, type FormHost } from './form/page';

export type PageView = Omit<Presentation, 'bar'>;

export function pageInputs(
  annotating: Annotating,
  view: () => PageView,
  host: FormHost,
) {
  const forms = attachForms(host);
  return {
    tools: [textTool(annotating, view)],
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
