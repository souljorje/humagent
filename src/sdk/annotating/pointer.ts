/** Pointer input on the page. While annotating is on, a press picks a target instead of using the page. */
import { isNativeInteractiveControl, isTarget } from '@/sdk/targets';
import { clickPoint } from '@/shared/dom';
import { pressOutside } from './capture';
import { isChanged } from './panel';
import { pick, pickSelection } from './picking';
import { hover } from './placement';
import { isEnabled, type Annotator } from './state';
import { hitTools } from './tools';

export interface PointerState {
  /** A marker press opens its editor, which can move the marker before the click. */
  markerPress: boolean;
}
type Origin = 'editor' | 'own' | 'control' | 'page';
type Handler = (a: Annotator, event: MouseEvent, origin: Origin) => void;

// Page shadow roots are not traversed. At document level, an event inside one targets its host.
const eventElement = ({ target }: Event) =>
  target instanceof Element ? target : undefined;

const isOwnEvent = (event: Event) =>
  event
    .composedPath()
    .some(
      (item) => item instanceof Element && item.matches('[data-humagent-ui]'),
    );

/** Classify a press: an inline editor, Humagent UI, a native control, or page content. */
function originOf({ capture }: Annotator, event: Event): Origin {
  const inline = capture.current?.editor?.element;
  if (inline && event.composedPath().includes(inline)) return 'editor';
  if (isOwnEvent(event)) return 'own';
  return isNativeInteractiveControl(eventElement(event) ?? null)
    ? 'control'
    : 'page';
}

function stop(event: Event, prevent = false) {
  if (prevent) event.preventDefault();
  event.stopImmediatePropagation();
}

const onPress: Handler = (a, event, origin) => {
  if (isChanged(a.capture.current)) return stop(event, true);
  if (!isEnabled(a) || origin !== 'control') return;
  const el = eventElement(event);
  const point = { x: event.clientX, y: event.clientY };
  const match = el && hitTools(a.tools, { el, point });
  // A press on a control's plain label may start an inline editor, so only that keeps its default.
  stop(event, !match || match === 'blocked');
};

const onClick: Handler = (a, event) => {
  const { target } = event;
  // A marker, or the unfinished input that the click would leave, takes it.
  if (a.pointer.markerPress || (a.capture.current && pressOutside(a)))
    return stop(event, true);
  if (!isTarget(target) || !isEnabled(a)) return;
  stop(event, true);
  if (document.getSelection()?.toString().trim()) return;
  const point = clickPoint(event);
  pick(a, { el: target, ...(point ? { point } : {}) });
};

const onPointerup: Handler = (a, event, origin) => {
  if (isEnabled(a) && origin === 'control') stop(event);
};

const onMouseup: Handler = (a, event, origin) => {
  if (!isEnabled(a)) return;
  const point = clickPoint(event);
  // The selection settles only after the default mouseup action.
  if (!a.capture.current && isTarget(event.target))
    setTimeout(() => pickSelection(a, point), 0);
  if (origin === 'control') stop(event);
};

const HANDLERS: ReadonlyMap<string, Handler> = new Map([
  ['pointerdown', onPress],
  ['mousedown', onPress],
  ['click', onClick],
  ['pointerup', onPointerup],
  ['mouseup', onMouseup],
]);

/** While annotating is on, presses target elements before the page can act on them. */
function intercept(a: Annotator, event: MouseEvent) {
  if (event.type === 'pointerdown') a.pointer.markerPress = false;
  const origin = originOf(a, event);
  if (origin === 'editor') stop(event, event.type === 'click');
  else if (origin !== 'own') HANDLERS.get(event.type)?.(a, event, origin);
}

function onPointermove(a: Annotator, event: PointerEvent) {
  if (!isEnabled(a) || isOwnEvent(event)) return;
  if (!a.capture.current && isTarget(event.target)) hover(a, event.target);
}

function onPointerleave(a: Annotator) {
  if (!a.capture.current) hover(a);
}

function onKeyup(a: Annotator, event: KeyboardEvent) {
  const origin = originOf(a, event);
  if (origin === 'editor') stop(event);
  else if (
    isEnabled(a) &&
    !a.capture.current &&
    event.shiftKey &&
    origin !== 'own'
  )
    pickSelection(a);
}

export function listenPointer(a: Annotator) {
  document.addEventListener('pointermove', (event) => onPointermove(a, event), {
    passive: true,
  });
  document.addEventListener('pointerleave', () => onPointerleave(a));
  for (const type of HANDLERS.keys())
    document.addEventListener(
      type,
      (event) => intercept(a, event as MouseEvent),
      true,
    );
  document.addEventListener('keyup', (event) => onKeyup(a, event), true);
}
