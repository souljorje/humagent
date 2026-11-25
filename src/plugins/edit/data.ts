import type { SavedReview, Target } from '../../shared/feedback.js';

/** Proposed wording for one text node. Empty `after` proposes deletion. */
export type EditData = { before: string; after: string };
/** The target of an edit also names one child text node of the element. */
export type EditTarget = Target & { textNode?: number };
/** Read the edit data from a review that the host gave this plugin. */
export const editOf = (saved: SavedReview | undefined) =>
  saved?.review.data as EditData | undefined;
/** Read the text node index from a review that the host gave this plugin. */
export const textNodeOf = (saved: SavedReview) =>
  (saved.review.target as EditTarget | undefined)?.textNode;
