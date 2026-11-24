import type { SavedReview } from '../../shared/feedback.js';

/** Proposed wording for one text node. Empty `after` proposes deletion. */
export type EditData = { before: string; after: string };
/** Read the edit data from a review that the host gave this plugin. */
export const editOf = (saved: SavedReview | undefined) =>
  saved?.review.data as EditData | undefined;
