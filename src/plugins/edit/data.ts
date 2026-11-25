import { LIMITS, type SavedReview, type Target } from '@/shared/feedback';
import { readSaved, type Contract, type DecodedReview } from '@/shared/plugin';
import { ensure, object, text } from '@/shared/validate';

/** Empty replacement text proposes deletion. */
type EditData = { before: string; after: string };
export type SavedEdit = DecodedReview<EditData>;
export type EditTarget = Target & { textNode?: number };

export const editContract: Contract<EditData> = {
  validateReview({ data, target }, previous) {
    ensure(target, 'An edit review requires a target');
    object(data, 'Edit');
    const original = previous?.data;
    if (original !== undefined) object(original, 'Saved edit');
    return {
      before: text((original ?? data).before, 'Edit before', LIMITS.text),
      after: text(data.after, 'Edit after', LIMITS.text, true),
    };
  },
};

export function savedEdits(previews: readonly SavedReview[]) {
  return previews.flatMap((saved) => {
    if (saved.review.kind !== 'edit') return [];
    const edit = readSaved(editContract, saved);
    return edit ? [edit] : [];
  });
}

export function textNodeOf({ review: { target } }: SavedReview) {
  if (target && 'textNode' in target && typeof target.textNode === 'number')
    return target.textNode;
}
