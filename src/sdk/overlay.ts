/** The page overlay: comment panel, markers, highlight, and keyboard hint. It draws a model and reports input. */
import { autosize, clickPoint, createElement, setText } from '@/shared/dom';
import { icon } from '@/shared/icons';
import { installTooltips } from '@/shared/tooltips';
import type { Point, Size } from './layout';
import css from './overlay.css?inline';

// The page cannot style a shadow root, so the overlay is the one sheet that needs its text.
const styles = new CSSStyleSheet();
styles.replaceSync(css);
import.meta.hot?.accept('./overlay.css?inline', (next) =>
  styles.replaceSync(next?.default ?? ''),
);

export interface MarkerModel {
  id: string;
  number: string;
  label: string;
  /** The marker's pending item is open in the panel. */
  expanded: boolean;
  highlighted: boolean;
  x: number;
  y: number;
}
export interface PanelModel {
  /** The panel edits a saved pending item. */
  existing: boolean;
  confirmLabel: string;
  confirmDisabled: boolean;
  saveDisabled: boolean;
  readOnly: boolean;
  /** The session accepts no input. */
  locked: boolean;
  error: string;
  position?: Point;
}
/** Everything the overlay shows. All positions are viewport pixels. */
export interface OverlayModel {
  /** The comment panel. Without it, the panel is closed. */
  panel?: PanelModel;
  /** Markers in view. */
  markers: MarkerModel[];
  /** Every pending review that can have a marker. Other markers are removed. */
  pendingIds: string[];
  highlight?: { left: number; top: number; width: number; height: number };
  /** The keyboard hint. Without it, the hint is hidden. */
  hint?: string;
}
/** What the human does in the overlay. */
export interface OverlayActions {
  comment(value: string): void;
  commentFocus(): void;
  confirm(): void;
  cancel(): void;
  remove(): void;
  /** A marker press, or its keyboard activation. `point` is where the human pressed. */
  marker(id: string, point: Point | undefined, press: boolean): void;
}

/** Every element of the overlay that its code uses. */
interface Controls {
  highlight: HTMLElement;
  markers: HTMLElement;
  'keyboard-hint': HTMLElement;
  panel: HTMLElement;
  editor: HTMLFormElement;
  comment: HTMLTextAreaElement;
  confirm: HTMLButtonElement;
  'editor-status': HTMLElement;
  'local-error': HTMLElement;
  actions: HTMLElement;
  remove: HTMLButtonElement;
  cancel: HTMLButtonElement;
  save: HTMLButtonElement;
}

const MARKUP = `<div id="highlight" class="highlight" hidden></div><div id="markers"></div>
  <p id="keyboard-hint" class="keyboard-hint" hidden role="status"></p>
  <section id="panel" class="panel glass-surface" role="dialog" aria-label="Review" hidden>
    <form id="editor" class="editor">
      <div class="compose"><textarea id="comment" class="feedback-input" aria-label="Comment" placeholder="Add a comment…" rows="1" maxlength="4000"></textarea><button class="primary icon" id="confirm" aria-label="Add comment" type="submit">${icon('check')}</button></div>
      <p id="editor-status" class="editor-status" role="status" hidden>Read only</p><p id="local-error" class="local-error" role="alert" hidden></p>
      <div id="actions" class="actions" hidden><button id="remove" class="remove icon" aria-label="Delete comment" type="button">${icon('trash')}</button><button id="cancel" class="cancel" type="button">Cancel</button><button class="save primary" id="save" type="submit">Save</button></div>
    </form>
  </section>`;
const SHAKE = ['0', '-4px', '4px', '0'].map((translate) => ({ translate }));

/** The overlay on the page. Its markers are keyed by review ID. */
export interface OverlayView {
  readonly shadow: ShadowRoot;
  readonly markers: Map<string, HTMLButtonElement>;
}

function control<K extends keyof Controls>(
  { shadow }: OverlayView,
  id: K,
): Controls[K] {
  return shadow.getElementById(id) as unknown as Controls[K];
}

export function createOverlayView(): OverlayView {
  const host = createElement('div', { dataset: { humagentUi: '' } });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = MARKUP;
  shadow.adoptedStyleSheets = [styles];
  // A transform on the body would move fixed elements.
  document.documentElement.append(host);
  installTooltips(shadow);
  return { shadow, markers: new Map() };
}

function onCommentInput(field: HTMLTextAreaElement, actions: OverlayActions) {
  autosize(field);
  actions.comment(field.value);
}

function onCommentKey(event: KeyboardEvent, actions: OverlayActions) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  actions.confirm();
}

function onSubmit(event: SubmitEvent, actions: OverlayActions) {
  event.preventDefault();
  actions.confirm();
}

/** The review ID of the marker that an event targets. */
const markerId = ({ target }: Event) =>
  target instanceof Element
    ? target.closest<HTMLElement>('.marker')?.dataset.reviewId
    : undefined;

function takeEvent(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

function onMarkerPress(event: PointerEvent, actions: OverlayActions) {
  const id = markerId(event);
  if (id === undefined || event.button !== 0 || !event.isPrimary) return;
  takeEvent(event);
  actions.marker(id, clickPoint(event), true);
}

/** Keyboard activation has no preceding pointer press. */
function onMarkerClick(event: MouseEvent, actions: OverlayActions) {
  const id = markerId(event);
  if (id === undefined) return;
  takeEvent(event);
  if (event.detail === 0) actions.marker(id, clickPoint(event), false);
}

/** Report what the human does in the overlay. */
export function listenOverlay(view: OverlayView, actions: OverlayActions) {
  const comment = control(view, 'comment');
  const markers = control(view, 'markers');
  comment.oninput = () => onCommentInput(comment, actions);
  comment.onkeydown = (event) => onCommentKey(event, actions);
  comment.onfocus = actions.commentFocus;
  control(view, 'cancel').onclick = actions.cancel;
  control(view, 'remove').onclick = actions.remove;
  control(view, 'editor').onsubmit = (event) => onSubmit(event, actions);
  markers.onpointerdown = (event) => onMarkerPress(event, actions);
  markers.onclick = (event) => onMarkerClick(event, actions);
}

function place(el: HTMLElement, x: number, y: number) {
  const transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  if (el.style.transform !== transform) el.style.transform = transform;
}

function showPanel(view: OverlayView, model: PanelModel) {
  const panel = control(view, 'panel');
  const comment = control(view, 'comment');
  const confirm = control(view, 'confirm');
  const remove = control(view, 'remove');
  const error = control(view, 'local-error');
  const opened = panel.hidden;
  panel.hidden = false;
  confirm.setAttribute('aria-label', model.confirmLabel);
  confirm.hidden = model.existing;
  confirm.disabled = model.confirmDisabled;
  control(view, 'actions').hidden = !model.existing;
  control(view, 'save').disabled = model.saveDisabled;
  remove.hidden = !model.existing;
  remove.disabled = model.readOnly;
  comment.readOnly = model.readOnly;
  control(view, 'editor-status').hidden = !model.locked;
  setText(error, model.error);
  error.hidden = !model.error;
  if (model.position) {
    panel.style.left = `${Math.round(model.position.x)}px`;
    panel.style.top = `${Math.round(model.position.y)}px`;
  }
  if (opened) autosize(comment);
}

function addMarker(view: OverlayView, id: string) {
  const marker = createElement('button', {
    className: 'marker glass-surface',
    dataset: { reviewId: id },
  });
  view.markers.set(id, marker);
  control(view, 'markers').append(marker);
  return marker;
}

function showMarkers(view: OverlayView, { markers, pendingIds }: OverlayModel) {
  const pending = new Set(pendingIds);
  const visible = new Set(markers.map(({ id }) => id));
  for (const [id, marker] of view.markers) {
    marker.hidden = !visible.has(id);
    if (pending.has(id)) continue;
    marker.remove();
    view.markers.delete(id);
  }
  for (const model of markers) {
    const marker = view.markers.get(model.id) ?? addMarker(view, model.id);
    marker.toggleAttribute('data-highlighted', model.highlighted);
    setText(marker, model.number);
    marker.ariaLabel = model.label;
    marker.ariaExpanded = String(model.expanded);
    place(marker, model.x, model.y);
  }
}

export function updateOverlay(view: OverlayView, model: OverlayModel) {
  const highlight = control(view, 'highlight');
  const hint = control(view, 'keyboard-hint');
  if (model.panel) showPanel(view, model.panel);
  else control(view, 'panel').hidden = true;
  showMarkers(view, model);
  highlight.hidden = !model.highlight;
  if (model.highlight) {
    place(highlight, model.highlight.left, model.highlight.top);
    highlight.style.width = `${model.highlight.width}px`;
    highlight.style.height = `${model.highlight.height}px`;
  }
  hint.hidden = model.hint === undefined;
  if (model.hint !== undefined) setText(hint, model.hint);
}

/** Replace the comment field's text. */
export function setComment(view: OverlayView, value: string) {
  const comment = control(view, 'comment');
  comment.value = value;
  if (!control(view, 'panel').hidden) autosize(comment);
}

export function focusComment(view: OverlayView) {
  control(view, 'comment').focus({ preventScroll: true });
}

/** Shake the panel to show that input is unfinished. */
export function shake(view: OverlayView) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const panel = control(view, 'panel');
  panel.getAnimations().forEach((animation) => animation.cancel());
  panel.animate(SHAKE, { duration: 180 });
}

/** Apply the height limit for the panel's width. Return the panel's size, or nothing while it is closed. */
export function measurePanel(
  view: OverlayView,
  limit: (width: number) => number,
): Size | undefined {
  const panel = control(view, 'panel');
  if (panel.hidden) return undefined;
  panel.style.maxHeight = `${Math.max(0, limit(panel.offsetWidth))}px`;
  const { width, height } = panel.getBoundingClientRect();
  return { width, height };
}

/** The marker of a pending item, for focus and geometry. */
export const markerOf = (
  { markers }: OverlayView,
  id: string,
): HTMLElement | undefined => markers.get(id);
