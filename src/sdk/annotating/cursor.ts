/** The keyboard cursor over the elements that a review can target, and its hint. */
import { isTarget } from '@/sdk/targets';
import { hover, schedule } from './placement';
import { render } from './render';
import type { Annotator } from './state';

const HINT = 'Arrow keys choose an element. Enter comments. Escape exits.';
const CANDIDATES =
  'h1,h2,h3,h4,p,li,td,th,img,a,button,input,select,textarea,label,[data-humagent-id],[role]';
const MAX_CANDIDATES = 2000;

export interface CursorState {
  candidates: readonly Element[];
  index: number;
  /** The shown hint, or nothing while it is hidden. */
  hint?: string;
  hintText: string;
}
export const createCursor = (): CursorState => ({
  candidates: [],
  index: -1,
  hintText: HINT,
});

export function moveCursor(a: Annotator, offset: number) {
  const { cursor } = a;
  const count = cursor.candidates.length;
  if (!count) return;
  cursor.index = (cursor.index + offset + count) % count;
  cursor.hintText = `Element ${cursor.index + 1} of ${count}. Arrow keys move. Enter opens a review. Escape exits.`;
  if (cursor.hint !== undefined) cursor.hint = cursor.hintText;
  const el = cursor.candidates[cursor.index];
  hover(a, el);
  el?.scrollIntoView({ block: 'nearest' });
  render(a);
  schedule(a);
}

export function showHint(a: Annotator) {
  a.cursor.hint = a.cursor.hintText;
  render(a);
}

/** Follow a mode change. The keyboard starts at the first element. */
export function startCursor(a: Annotator, keyboard: boolean) {
  a.cursor.hint = keyboard ? a.cursor.hintText : undefined;
  if (!keyboard) return;
  a.cursor.candidates = [...document.querySelectorAll(CANDIDATES)]
    .filter((el) => isTarget(el) && el.getClientRects().length)
    .slice(0, MAX_CANDIDATES);
  a.cursor.index = -1;
  moveCursor(a, 1);
}
