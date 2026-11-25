import type { Plugin } from '../shared/plugin.js';
import { ensure } from '../shared/validate.js';

/** A comment on a page element. */
export const comment: Plugin = {
  kind: 'comment',
  // The review has no data, so it needs a comment.
  contract: {
    validateReview(review) {
      ensure(review.target, 'A comment review requires a target');
      ensure(review.data === undefined, 'A comment cannot include data');
      ensure(review.comment, 'A comment needs text');
      return undefined;
    },
  },
  // The last tool: a pick with a comment and no other review becomes a comment.
  page: () => ({
    tool: {
      name: 'Comment',
      build: (comment) => (comment.trim() ? { comment } : undefined),
    },
  }),
  summary: {
    title: ({ review }) => String(review.target?.id || 'Comment'),
  },
};
