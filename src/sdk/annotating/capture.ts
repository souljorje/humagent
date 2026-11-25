/** The open editor: its input, its validity, and its save. At most one is open. */
import type { PageEvents, Requests } from '../../shared/bridge.js';
import { errorMessage } from '../../shared/errors.js';
import type { NewReview, SaveResult, Target } from '../../shared/feedback.js';
import type { MarkerLocal } from '../../shared/marker.js';
import type { Point } from '../layout.js';
import type { OverlayView, PanelModel } from '../overlay.js';
import { findTarget } from '../targets.js';
import type { Draft, Tools } from './tools.js';

export interface Capture extends Draft {
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
/** The workspace requests that save an editor's input. */
export interface ReviewRequests {
  save(review: NewReview, options: { local: MarkerLocal }): Promise<SaveResult>;
  edit(params: Requests['edit']['params']): Promise<null>;
  remove(reviewId: string): Promise<null>;
}
interface Hooks {
  requests: ReviewRequests;
  writable(): boolean;
  /** Report whether the editor has unfinished input. */
  editing(state: PageEvents['editing']): void;
  render(): void;
  schedule(): void;
  position(): void;
  /** The page no longer points at an element. */
  closed(): void;
}

export function createCapture(view: OverlayView, tools: Tools, hooks: Hooks) {
  let captured: Capture | undefined;
  let returnFocus: Element | null = null;
  function changed() {
    if (!captured) return false;
    const { comment } = captured;
    const commentChanged = captured.saved
      ? comment !== (captured.saved.review.comment || '')
      : !!comment;
    return commentChanged || !!captured.editor?.changed();
  }
  /** Input that the human has not saved or discarded. */
  const unfinished = () => !!captured?.saving || changed();
  /** Input is valid when the inline editor accepts it and a tool builds a review from it. */
  function validInput() {
    return (
      !!captured &&
      (!captured.editor || captured.editor.valid()) &&
      !!tools.build(captured, captured.target)
    );
  }
  function input() {
    if (captured) captured.outsidePresses = 0;
    update();
  }
  function panel(position: Point | undefined): PanelModel | undefined {
    if (!captured) return;
    const readOnly = captured.saving || !hooks.writable();
    const confirmDisabled = readOnly || !validInput();
    return {
      existing: !!captured.saved,
      confirmLabel: captured.editor?.confirmLabel ?? 'Add comment',
      confirmDisabled,
      saveDisabled: confirmDisabled || (!!captured.saved && !changed()),
      readOnly,
      locked: !hooks.writable(),
      error: captured.error,
      position,
    };
  }
  function update() {
    hooks.editing({ dirty: unfinished() });
    captured?.editor?.setReadOnly(captured.saving || !hooks.writable());
    hooks.render();
    hooks.schedule();
  }
  /** Bring the human back to unfinished input. */
  function refocus({ activeInput, editor }: Capture) {
    const inline = editor?.element;
    if (activeInput instanceof HTMLElement && activeInput.isConnected)
      activeInput.focus({ preventScroll: true });
    else if (activeInput !== 'comment' && inline)
      inline.focus({ preventScroll: true });
    else view.focusComment();
    view.shake();
  }
  /** Handle a press outside the editor. Return whether the editor had unfinished input, which takes the press. */
  function outside() {
    if (!captured) return false;
    if (!unfinished()) {
      close();
      return false;
    }
    if (!captured.saving && ++captured.outsidePresses >= 2) close();
    else refocus(captured);
    return true;
  }
  function close(force = false) {
    if (captured?.saving && !force) return;
    const closing = captured;
    captured = undefined;
    hooks.render();
    closing?.editor?.close();
    tools.layout();
    hooks.closed();
    if (
      returnFocus?.isConnected &&
      'focus' in returnFocus &&
      typeof returnFocus.focus === 'function'
    )
      returnFocus.focus({ preventScroll: true });
    update();
  }
  /** Close the editor and keep the element that gets focus back later. */
  function reopen(focus?: Element) {
    close();
    returnFocus = focus || document.activeElement;
  }
  /** Open an editor. An inline editor takes focus in place of the comment field. */
  function open(
    capture: Pick<
      Capture,
      'target' | 'el' | 'saved' | 'point' | 'tool' | 'editor'
    >,
  ) {
    const inline = capture.editor?.element;
    const opened: Capture = {
      ...capture,
      comment: capture.saved?.review.comment || '',
      error: '',
      saving: false,
      outsidePresses: 0,
      activeInput: inline,
    };
    captured = opened;
    if (inline)
      inline.onfocus = () => {
        opened.activeInput = inline;
      };
    view.setComment(opened.comment);
    update();
    hooks.position();
    if (!inline) view.focusComment();
  }
  async function save(remove = false) {
    if (!captured || captured.saving || !hooks.writable()) return;
    if (!remove && (!validInput() || (!!captured.saved && !changed()))) return;
    const el = findTarget(captured.target);
    if (!el) {
      captured.error =
        'Target unavailable. Cancel this edit and inspect the page.';
      hooks.render();
      return;
    }
    captured.el = el;
    const current = captured;
    current.saving = true;
    update();
    try {
      if (remove && current.saved)
        await hooks.requests.remove(current.saved.review.id);
      else if (current.saved) {
        // An edit keeps the kind. It takes the comment field and the built data.
        const data = tools.build(current, current.target)?.data;
        await hooks.requests.edit({
          reviewId: current.saved.review.id,
          comment: current.comment,
          ...(data !== undefined ? { data } : {}),
        });
      } else {
        const targetRect = current.el.getBoundingClientRect();
        const coordinates = {
          x: Math.round(targetRect.left + current.point.x + scrollX),
          y: Math.round(targetRect.top + current.point.y + scrollY),
          space: 'document',
        };
        const review = tools.build(current, {
          ...current.target,
          coordinates,
        });
        if (!review) throw new Error('Add a comment or a change.');
        const local: MarkerLocal = {
          marker: { x: current.point.x, y: current.point.y },
        };
        await hooks.requests.save(review, { local });
      }
      current.saving = false;
      // A presentation can close this editor during the save. Another editor can be open now.
      if (captured === current) close();
    } catch (error) {
      current.error = errorMessage(error);
    } finally {
      current.saving = false;
      update();
    }
  }
  return {
    current: (): Readonly<Capture> | undefined => captured,
    open,
    reopen,
    close,
    outside,
    changed,
    unfinished,
    input,
    update,
    save,
    panel,
    comment(value: string) {
      if (!captured) return;
      captured.comment = value;
      input();
    },
    commentFocus() {
      if (captured) captured.activeInput = 'comment';
    },
  };
}
export type CaptureState = ReturnType<typeof createCapture>;
