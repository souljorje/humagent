/** The open editor: its input and its save. At most one is open. */
import type { Point } from '@/sdk/layout';
import { focusComment, setComment, shake } from '@/sdk/overlay';
import { findTarget } from '@/sdk/targets';
import { errorMessage } from '@/shared/errors';
import type { SavedReview, Target } from '@/shared/feedback';
import { draftOf, isChanged, isUnfinished } from './panel';
import { hover, position, schedule } from './placement';
import { render } from './render';
import { report, type Annotator } from './state';
import { layoutTools } from './tools';
import type { Draft, Editor } from './types';

export interface Capture {
  saved?: SavedReview;
  editor?: Editor;
  target: Target;
  el: Element;
  point: Point;
  /** The comment field's text. The view owns the field. This copy follows its input. */
  comment: string;
  error: string;
  saving: boolean;
  /** Presses outside the editor since the last input. */
  outsidePresses: number;
  /** The input that had focus last: the comment field or an inline editor. */
  activeInput?: HTMLElement | 'comment';
}
export interface CaptureState {
  current?: Capture;
  /** The element that gets focus after the editor closes. */
  returnFocus: Element | null;
}
type Opening = Pick<Capture, 'target' | 'el' | 'saved' | 'point' | 'editor'>;

/** Draw the editor and report its state. */
export function updateCapture(a: Annotator) {
  const { current } = a.capture;
  report(a, 'editing', { dirty: isUnfinished(current) });
  current?.editor?.setReadOnly(current.saving || !a.writable());
  render(a);
  schedule(a);
}

export function changeInput(a: Annotator) {
  if (a.capture.current) a.capture.current.outsidePresses = 0;
  updateCapture(a);
}

export function changeComment(a: Annotator, value: string) {
  if (!a.capture.current) return;
  a.capture.current.comment = value;
  changeInput(a);
}

export function focusedComment({ capture }: Annotator) {
  if (capture.current) capture.current.activeInput = 'comment';
}

export function closeCapture(a: Annotator, force = false) {
  const closing = a.capture.current;
  const { returnFocus } = a.capture;
  if (closing?.saving && !force) return;
  a.capture.current = undefined;
  render(a);
  closing?.editor?.close();
  layoutTools(a.tools);
  // The page no longer points at an element.
  hover(a);
  if (
    returnFocus?.isConnected &&
    'focus' in returnFocus &&
    typeof returnFocus.focus === 'function'
  )
    returnFocus.focus({ preventScroll: true });
  updateCapture(a);
}

/** Bring the human back to unfinished input. */
function refocus({ view }: Annotator, { activeInput, editor }: Capture) {
  const inline = editor?.element;
  if (activeInput instanceof HTMLElement && activeInput.isConnected)
    activeInput.focus({ preventScroll: true });
  else if (activeInput !== 'comment' && inline)
    inline.focus({ preventScroll: true });
  else focusComment(view);
  shake(view);
}

/**
 * Handle a press outside the editor. Return whether the editor had unfinished input, which takes the press.
 * The second press discards the input.
 */
export function pressOutside(a: Annotator) {
  const { current } = a.capture;
  if (!current) return false;
  const unfinished = isUnfinished(current);
  if (!unfinished) closeCapture(a);
  else if (!current.saving && ++current.outsidePresses >= 2) closeCapture(a);
  else refocus(a, current);
  return unfinished;
}

/** Close the editor and keep the element that gets focus back later. */
export function prepareCapture(a: Annotator, focus?: Element) {
  closeCapture(a);
  a.capture.returnFocus = focus || document.activeElement;
}

/** Open an editor. An inline editor takes focus in place of the comment field. */
export function openCapture(a: Annotator, opening: Opening) {
  const inline = opening.editor?.element;
  const capture: Capture = {
    ...opening,
    comment: opening.saved?.review.comment || '',
    error: '',
    saving: false,
    outsidePresses: 0,
    activeInput: inline,
  };
  a.capture.current = capture;
  if (inline)
    inline.onfocus = () => {
      capture.activeInput = inline;
    };
  setComment(a.view, capture.comment);
  updateCapture(a);
  position(a);
  if (!inline) focusComment(a.view);
}

async function saveNew({ bridge }: Annotator, capture: Capture, draft: Draft) {
  const { el, point, target } = capture;
  const rect = el.getBoundingClientRect();
  const coordinates = {
    x: Math.round(rect.left + point.x + scrollX),
    y: Math.round(rect.top + point.y + scrollY),
    space: 'document',
  };
  await bridge.save(
    { ...draft, target: { ...target, coordinates } },
    { marker: point },
  );
}

export async function saveCapture(a: Annotator, remove = false) {
  const { current } = a.capture;
  if (!current || current.saving || !a.writable()) return;
  const draft = remove ? undefined : draftOf(current);
  if (!remove && (!draft || (current.saved && !isChanged(current)))) return;
  const el = findTarget(current.target);
  if (!el) {
    current.error =
      'Target unavailable. Cancel this edit and inspect the page.';
    render(a);
    return;
  }
  const id = current.saved?.review.id;
  current.el = el;
  current.saving = true;
  updateCapture(a);
  try {
    if (id !== undefined && remove) await a.bridge.remove(id);
    else if (id !== undefined && draft) {
      await a.bridge.edit({
        reviewId: id,
        comment: current.comment,
        ...(draft.data !== undefined ? { data: draft.data } : {}),
      });
    } else if (draft) await saveNew(a, current, draft);
    current.saving = false;
    // A presentation can close this editor during the save. Another editor can be open now.
    if (a.capture.current === current) closeCapture(a);
  } catch (error) {
    current.error = errorMessage(error);
  } finally {
    current.saving = false;
    updateCapture(a);
  }
}
