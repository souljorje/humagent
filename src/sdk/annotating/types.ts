/** How annotating asks a plugin about a pick, and what the plugin can ask in return. */
import type { NewReview, SavedReview, Target } from '@/shared/feedback';

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
/** A tool's claim on a pick. The SDK opens its editor after recording the target. */
export interface Hit {
  el: Element;
  /** The saved pending review that the pick reopens. */
  saved?: SavedReview;
  open(): Editor;
}
/** The editor chooses the kind. The SDK supplies the captured target when saving. */
export type Draft = Omit<NewReview, 'target'>;
/** A tool's inline editor for one pick. */
export interface Editor {
  /** Target fields that the editor adds, such as a text node index. */
  target?: Target;
  /** The input that takes focus in place of the comment field. */
  element?: HTMLElement;
  confirmLabel: string;
  build(comment: string): Draft | undefined;
  changed(): boolean;
  setReadOnly(value: boolean): void;
  close(): void;
}
/** A plugin's part in element picking. The SDK asks tools in registry order. */
export interface Tool {
  /** The marker label of a pending review without a comment. */
  name: string;
  /** Claim a pick. `blocked` stops the pick without an editor. */
  hit?(pick: Pick): Hit | 'blocked' | undefined;
  /** The original text of a node that this tool changed on the page. */
  textOf?(node: Node): string | undefined;
  /** The start of each positioning pass. */
  layout?(): void;
}
/** Page plugins use these methods to resolve saved targets and operate the open editor. */
export interface Annotating {
  /** The element of a pending review's target on this page revision. */
  resolve(saved: SavedReview): Element | null;
  /** An inline editor reports input, confirm, and cancel. */
  input(): void;
  confirm(): void;
  cancel(): void;
}
