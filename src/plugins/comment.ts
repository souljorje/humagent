import type { Plugin } from '../shared/plugin.js';
import { ensure } from '../shared/validate.js';

/** A comment on a page element. */
export const comment: Plugin = {
  kind: 'comment',
  // The review has no data, so it needs a comment.
  contract: {
    target: true,
    validate(review) {
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
  workspace: {
    card: {
      title: ({ review }) =>
        String(review.target?.id || review.target?.tag || 'Comment'),
    },
  },
};
