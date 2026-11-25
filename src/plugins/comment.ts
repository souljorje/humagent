import { definePlugin } from '@/shared/plugin';
import { ensure } from '@/shared/validate';

export function commentDraft(comment: string, kind = 'comment') {
  return comment.trim() ? { kind, comment } : undefined;
}

/** A comment on a page element. */
export const comment = definePlugin(
  {
    // The review has no data, so it needs a comment.
    validateReview(review) {
      ensure(review.target, 'A comment review requires a target');
      ensure(review.data === undefined, 'A comment cannot include data');
      ensure(review.comment, 'A comment needs text');
      return undefined;
    },
  },
  ({ review }) => ({ title: String(review.target?.id || 'Comment') }),
);
