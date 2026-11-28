/** Plugin interfaces. A plugin adds one kind of feedback review. The transport names no kind. */
import type { Annotating, Tool } from '@/sdk/annotating/types';
import type {
  SavedReview,
  NewReview,
  Review,
  SaveResult,
  Unsaved,
} from './feedback';
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

/** What the page host gives to each page plugin. */
export interface PageHost {
  /** The plugin's own attribute, `data-humagent-<kind>`. Page authors mark elements with it. */
  attribute: string;
  /** Save a pending review. A `key` makes it the one pending review of its kind with that key. */
  save(
    review: Omit<NewReview, 'kind'>,
    options?: { key?: string; local?: Json },
  ): Promise<SaveResult>;
  /**
   * Report input that the plugin has not saved. Nothing means that all input is saved.
   * Send waits while a plugin is saving. An HTML file does not reload on its own while a plugin has unsaved input.
   */
  unsaved(state?: Unsaved): void;
  /** Show a problem to the human in the bar. */
  notice(message: string): void;
  annotating: Annotating;
}
/** A plugin's share of the saved feedback. */
export interface PluginView {
  /** Pending reviews of this kind on this page revision. */
  readonly pending: readonly SavedReview[];
  /** Pending reviews and sent reviews of the plugin's kind and of the page's revision. */
  readonly previews: readonly SavedReview[];
  writable: boolean;
}
/** Each plugin can add its public page methods to this interface. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Plugins extend this interface through declaration merging.
export interface PageMethods {}
declare global {
  interface Window {
    humagent: Readonly<PageMethods>;
  }
}
/**
 * The page half of a plugin. The host creates it one time for each page document.
 * A reload makes a new document, so the interface has no disposal.
 */
export interface PagePlugin {
  /** The plugin's tool for annotating. */
  tool?: Tool;
  /** The first presentation after the page attaches. */
  init?(view: PluginView): void;
  present?(view: PluginView): void;
  /** Clean up a keyed pending review before the host removes it from this revision. */
  discard?(saved: SavedReview): void;
  /** Members of `window.humagent`. */
  api?: Partial<PageMethods>;
}

/** One kind of feedback review: its data rules, its behavior on the page, and its pending review in the bar. */
export interface Plugin {
  /** The plugin name and the kind of its reviews. */
  kind: string;
  contract: Contract;
  /** Behavior in the page. The host calls it one time for each page document. */
  page?(host: PageHost): PagePlugin;
  summary?: ReviewSummary;
}
