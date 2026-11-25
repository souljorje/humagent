/** Pointer input on the page. While annotating is on, a press picks a target instead of using the page. */
import { clickPoint } from '../../shared/dom.js';
import { isNativeInteractiveControl, isTarget } from '../targets.js';
import type { CaptureState } from './capture.js';
import type { Picking } from './picking.js';
import type { Tools } from './tools.js';

interface Hooks {
  enabled(): boolean;
  hover(el?: Element): void;
}

// Page shadow roots are not traversed. At document level, an event inside one targets its host.
const eventElement = (event: Event) =>
  event.target instanceof Element ? event.target : undefined;
const ownEvent = (event: Event) =>
  event
    .composedPath()
    .some(
      (item) => item instanceof Element && item.matches('[data-humagent-ui]'),
    );

export function installPointer(
  tools: Tools,
  capture: CaptureState,
  picking: Picking,
  hooks: Hooks,
) {
  // A marker press opens its editor, which can move the marker before the click.
  let markerPress = false;
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!hooks.enabled()) return;
      if (ownEvent(event)) return;
      if (capture.current() || !isTarget(event.target)) return;
      hooks.hover(event.target);
    },
    { passive: true },
  );
  document.addEventListener('pointerleave', () => {
    if (!capture.current()) hooks.hover();
  });
  /** Classify a press: an inline editor, Humagent UI, a native control, or page content. */
  function eventOrigin(event: Event): 'editor' | 'own' | 'control' | 'page' {
    const inline = capture.current()?.editor?.element;
    if (inline && event.composedPath().includes(inline)) return 'editor';
    if (ownEvent(event)) return 'own';
    return isNativeInteractiveControl(eventElement(event) || null)
      ? 'control'
      : 'page';
  }
  function stop(event: Event, prevent = false) {
    if (prevent) event.preventDefault();
    event.stopImmediatePropagation();
  }
  /** While annotating is on, presses target elements before the page can act on them. */
  function intercept(event: MouseEvent) {
    if (event.type === 'pointerdown') markerPress = false;
    const from = eventOrigin(event);
    if (from === 'editor') return stop(event, event.type === 'click');
    if (from === 'own') return;
    const point = clickPoint(event);
    switch (event.type) {
      case 'pointerdown':
      case 'mousedown':
        if (capture.changed()) stop(event, true);
        // A press on a control's plain label may start an inline editor, so only that keeps its default.
        else if (hooks.enabled() && from === 'control') {
          const el = eventElement(event);
          const match =
            el &&
            tools.hit({ el, point: { x: event.clientX, y: event.clientY } });
          stop(event, !match || match.hit === 'blocked');
        }
        return;
      case 'click': {
        if (markerPress || (capture.current() && capture.outside()))
          return stop(event, true);
        if (!isTarget(event.target) || !hooks.enabled()) return;
        stop(event, true);
        if (document.getSelection()?.toString().trim()) return;
        picking.pick({
          el: event.target,
          ...(point ? { point } : {}),
        });
        return;
      }
      case 'pointerup':
        if (hooks.enabled() && from === 'control') stop(event);
        return;
      case 'mouseup':
        if (!hooks.enabled()) return;
        // The selection settles only after the default mouseup action.
        if (!capture.current() && isTarget(event.target))
          setTimeout(() => picking.selectedText(point), 0);
        if (from === 'control') stop(event);
    }
  }
  for (const type of [
    'pointerdown',
    'mousedown',
    'click',
    'pointerup',
    'mouseup',
  ])
    document.addEventListener(type, intercept as EventListener, true);
  document.addEventListener(
    'keyup',
    (event) => {
      const from = eventOrigin(event);
      if (from === 'editor') return stop(event);
      if (
        hooks.enabled() &&
        !capture.current() &&
        event.shiftKey &&
        from !== 'own'
      )
        picking.selectedText();
    },
    true,
  );
  return {
    markerPressed() {
      markerPress = true;
    },
  };
}
