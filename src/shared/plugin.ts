/** Plugin interfaces. A plugin adds one kind of feedback review. The transport names no kind. */
import type { SavedReview, Review } from './feedback';
import type { Json } from './json';
import type { Envelope } from './validate';

/**
 * The data rules of one plugin. The workspace applies them to each review from the page, before it saves the review.
 * The server checks only the envelope and the limits.
 */
export interface Contract {
  /**
   * Check the whole review after the envelope check. Cross-field rules belong here.
   * Return the review's data, or nothing for a kind without data.
   * `previous` is set for an edit and for a keyed replacement.
   */
  validateReview(review: Envelope, previous?: Review): Json | undefined;
  /** Validate the plugin's private data. */
  validateLocal?(value: unknown): Json | undefined;
}

/** How a plugin presents a pending review. */
export interface ReviewSummary {
  title(saved: SavedReview): string;
  /** Draw content between the title and the comment. */
  body?(saved: SavedReview): Node | undefined;
}

export interface Plugin extends Contract {
  readonly summary?: ReviewSummary;
}
