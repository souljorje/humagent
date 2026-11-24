/** Plugin interfaces. A plugin adds one kind of feedback review. The transport names no kind. */
import type {
  SavedReview,
  NewReview,
  Review,
  Target,
  SaveResult,
} from './feedback.js';
import type { Json } from './json.js';
import type { Envelope } from './validate.js';

/**
 * The data rules of one plugin. The workspace applies them to each review from the page, before it saves the review.
 * The server checks only the envelope and the limits.
 */
export interface Contract {
  /** Whether each review has a target. A review of the other shape is refused. */
  target: boolean;
  /**
   * Check the whole review after the envelope check. Cross-field rules belong here.
   * Return the review's data, or nothing for a kind without data.
   * `previous` is set for an edit and for a keyed replacement.
   */
  validate(review: Envelope, previous?: Review): Json | undefined;
  /** Validate plugin-specific local data. Targeting owns the marker field on targeted reviews. */
  local?(value: unknown): Json | undefined;
}

/** What a pending review card gives to the plugin that draws its content. */
export interface CardTools {
  /** Open the pending review's editor on the page, like a press on the card. */
  open(): void;
}
/** The pending review of one kind in the workspace bar. */
export interface WorkspacePlugin {
  /** Whether the page cleans up before the pending review is removed. */
  discardOnPage?(saved: SavedReview): boolean;
  /** How the pending review looks. Rendering only. */
  card: {
    title(saved: SavedReview): string;
    /** Draw the pending review's content. The card shows it between the title and the comment. */
    body?(saved: SavedReview, tools: CardTools): Node | undefined;
    /** CSS for the body. The bar adopts it once. */
    styles?: string;
  };
}

/** What the human pointed at. One of `saved`, `range`, `point`, or `keyboard` says how. */
export interface Pick {
  el: Element;
  /** A saved pending review that the human reopens. */
  saved?: SavedReview;
  /** A text selection. */
  range?: Range;
  /** A press at this viewport point. */
  point?: { x: number; y: number };
  /** A keyboard choice of the element. */
  keyboard?: boolean;
}
/** A tool's claim on a pick. Targeting opens it after recording the target. */
export interface Hit {
  el: Element;
  /** The saved pending review that the pick reopens. */
  saved?: SavedReview;
  open(): Editor;
}
/** Return review fields when this editor or tool accepts the input. */
type BuildReview = (
  comment: string,
) => Omit<NewReview, 'kind' | 'target'> | undefined;
/** A tool's inline editor for one pick. */
export interface Editor {
  /** Target fields that the editor adds, such as a text node index. */
  target?: Target;
  /** The input that takes focus in place of the comment field. */
  element?: HTMLElement;
  confirmLabel: string;
  build: BuildReview;
  changed(): boolean;
  valid(): boolean;
  setReadOnly(value: boolean): void;
  close(): void;
}
/** A plugin's part in element picking. Targeting asks tools in registry order. */
export interface Tool {
  /** The marker label of a pending review without a comment. */
  name: string;
  /** Claim a pick. `blocked` stops the pick without an editor. */
  hit?(pick: Pick): Hit | 'blocked' | undefined;
  /** Build a review when the open editor supplies none. */
  build?: BuildReview;
  /** The original text of a node that this tool changed on the page. */
  textOf?(node: Node): string | undefined;
  /** The start of each positioning pass. */
  layout?(): void;
}
/** Shared element picking: pick mode, markers, highlight, and the comment panel. */
export interface Targeting {
  /** The element of a pending review's target on this page revision. */
  resolve(saved: SavedReview): Element | null;
  /** An inline editor reports input, confirm, and cancel. */
  input(): void;
  confirm(): void;
  cancel(): void;
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
  /** Show a problem to the human in the bar. */
  notice(message: string): void;
  targeting: Targeting;
}
/** A plugin's share of the saved feedback. */
export interface PluginView {
  /** Pending reviews of this kind on this page revision. */
  pending: SavedReview[];
  /** Pending reviews and sent reviews of the plugin's kind and of the page's revision. */
  previews: SavedReview[];
  writable: boolean;
}
/** Each plugin can add its public page methods to this interface. */
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
  /** The plugin's tool for element targeting. */
  tool?: Tool;
  /** The first presentation after the page attaches. */
  init?(view: PluginView): void;
  present?(view: PluginView): void;
  /** The human deletes this pending review in the bar. Clean up the page. The host then removes the pending review. */
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
  workspace?: WorkspacePlugin;
}
