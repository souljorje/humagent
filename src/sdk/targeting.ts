/**
 * Shared element picking. The page owns geometry and temporary editors. The parent owns saved feedback.
 * Tools decide which kind of review a pick becomes. This module names no kind and builds no markup.
 */
import { context, isNativeInteractiveControl } from './targets.js';
import {
  createOverlayView,
  type MarkerModel,
  type OverlayModel,
} from './overlay.js';
import { inView, markerPoint, panelPoint, type Point } from './layout.js';
import type {
  Bootstrap,
  PageEvents,
  Presentation,
  Requests,
} from '../shared/bridge.js';
import {
  LIMITS,
  type Availability,
  type SavedReview,
  type SaveResult,
  type NewReview,
  type Target,
} from '../shared/feedback.js';
import type { Editor, Hit, Pick, Targeting, Tool } from '../shared/plugin.js';
import { clickPoint } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import type { MarkerLocal } from '../shared/marker.js';

interface TargetingBridge {
  boot: Bootstrap;
  save(review: NewReview, options: { local: MarkerLocal }): Promise<SaveResult>;
  edit(params: Requests['edit']['params']): Promise<null>;
  remove(reviewId: string): Promise<null>;
  notice(message: string): void;
  post<M extends keyof PageEvents>(method: M, params: PageEvents[M]): void;
}
type RegisteredTool = Tool & { kind: string };
interface Capture {
  target: Target;
  el: Element;
  saved?: SavedReview;
  point: Point;
  /** The tool that claimed the pick, and its inline editor. */
  tool?: RegisteredTool;
  editor?: Editor;
}
const HINT = 'Arrow keys choose an element. Enter comments. Escape exits.';

export function createTargeting(bridge: TargetingBridge) {
  const { boot, notice, post } = bridge;
  const tools: RegisteredTool[] = [];
  let pending: SavedReview[] = [],
    writable = false;
  let captured: Capture | null = null,
    hovered: Element | undefined;
  let highlightedReview: string | undefined;
  let bar: Presentation['bar'] | undefined;
  // A marker press opens its editor, which can move the marker before the click.
  let markerPress = false;
  let annotating = false,
    saving = false,
    scheduled = false;
  const enabled = () => annotating && writable;
  let lastAvailability = '',
    lastScrollbars = '',
    lastDirty = false;
  let returnFocus: Element | null = null;
  let candidates: Element[] = [],
    cursor = -1;
  let outsideClicks = 0;
  /** The input that had focus last: the comment field or an inline editor. */
  let activeInput: HTMLElement | 'comment' | null = null;
  /** The comment panel's state. The view owns the field. This copy follows its input. */
  let panelOpen = false,
    comment = '',
    localError = '';
  let hint: string | undefined,
    hintText = HINT;
  /** The marker, highlight, and panel positions of the last positioning pass. */
  let layout: {
    markers: MarkerModel[];
    highlight?: OverlayModel['highlight'];
    panel?: Point;
  } = { markers: [] };
  const view = createOverlayView({
    comment(value) {
      comment = value;
      input();
    },
    commentFocus() {
      activeInput = 'comment';
    },
    confirm: () => void save(),
    cancel: () => close(),
    remove: () => void save(true),
    marker(id, point, press) {
      if (press) markerPress = true;
      if (saving) return;
      if (captured && captured.saved?.review.id !== id) close();
      edit(id, point || center(view.marker(id)));
    },
  });

  const ignored = (el: EventTarget | null) =>
    !(el instanceof Element) ||
    el.closest('[data-humagent-ui],script,style,head') ||
    el === document.documentElement;
  // Page shadow roots are not traversed. At document level, an event inside one targets its host.
  const eventElement = (event: Event) =>
    event.target instanceof Element ? event.target : undefined;
  const ownEvent = (event: Event) =>
    event
      .composedPath()
      .some(
        (item) => item instanceof Element && item.matches('[data-humagent-ui]'),
      );
  /** The text of a node as the application wrote it, without the changes of any tool. */
  function textOf(node: Node): string {
    for (const tool of tools) {
      const original = tool.textOf?.(node);
      if (original !== undefined) return original;
    }
    if (node instanceof Text) return node.data;
    return [...node.childNodes].map(textOf).join('');
  }
  const targetOf = (el: Element): Target => ({
    ...context(el, textOf(el)),
    url: boot.sourceUrl,
  });
  /** Ask the tool with the open editor to build a review, then the other tools in registry order. */
  function build(target: Target): NewReview | undefined {
    if (!captured) return undefined;
    const fields = captured.editor?.build(comment);
    if (fields && captured.tool)
      return { ...fields, kind: captured.tool.kind, target };
    for (const tool of tools) {
      const review = tool.build?.(comment);
      if (review) return { ...review, kind: tool.kind, target };
    }
    return undefined;
  }
  function changed() {
    if (!captured || (!panelOpen && !captured.editor)) return false;
    const commentChanged = captured.saved
      ? comment !== (captured.saved.review.comment || '')
      : !!comment;
    return commentChanged || !!captured.editor?.changed();
  }
  /** Input is valid when the inline editor accepts it and a tool builds a review from it. */
  function validInput() {
    return (
      !!captured &&
      (!captured.editor || captured.editor.valid()) &&
      !!build(captured.target)
    );
  }
  function input() {
    outsideClicks = 0;
    updateEditor();
  }
  function render() {
    const valid = validInput();
    view.update({
      ...(panelOpen && captured
        ? {
            panel: {
              existing: !!captured.saved,
              confirmLabel: captured.editor?.confirmLabel ?? 'Add comment',
              confirmDisabled: saving || !writable || !valid,
              saveDisabled:
                saving ||
                !writable ||
                !valid ||
                (!!captured.saved && !changed()),
              removeDisabled: saving || !writable,
              readOnly: saving || !writable,
              locked: !writable,
              error: localError,
              ...(layout.panel ? { position: layout.panel } : {}),
            },
          }
        : {}),
      markers: layout.markers,
      pendingIds: pending.map((saved) => saved.review.id),
      ...(layout.highlight ? { highlight: layout.highlight } : {}),
      ...(hint !== undefined ? { hint } : {}),
    });
  }
  function updateEditor() {
    const dirty = saving || changed();
    if (lastDirty !== dirty) {
      lastDirty = dirty;
      post('editing', { dirty });
    }
    captured?.editor?.setReadOnly(saving || !writable);
    render();
    schedule();
  }
  function outside() {
    if (!captured) return false;
    if (saving || changed()) {
      if (!saving && ++outsideClicks >= 2) close();
      else {
        const inline = captured.editor?.element;
        if (activeInput instanceof HTMLElement && activeInput.isConnected)
          activeInput.focus({ preventScroll: true });
        else if (activeInput !== 'comment' && inline)
          inline.focus({ preventScroll: true });
        else view.focusComment();
        view.shake();
      }
      return true;
    }
    close();
    return false;
  }
  function close(force = false) {
    if (saving && !force) return;
    panelOpen = false;
    render();
    captured?.editor?.close();
    for (const tool of tools) tool.layout?.();
    outsideClicks = 0;
    captured = null;
    activeInput = null;
    hovered = undefined;
    if (
      returnFocus?.isConnected &&
      'focus' in returnFocus &&
      typeof returnFocus.focus === 'function'
    )
      returnFocus.focus({ preventScroll: true });
    updateEditor();
  }
  /** Close the editor and keep the element that gets focus back later. */
  function reopen(focus?: Element) {
    close();
    returnFocus = focus || document.activeElement;
  }
  function setMode(value: boolean, keyboard = false) {
    if (outside()) {
      post('annotating', { enabled: enabled() });
      return;
    }
    close();
    annotating = value;
    syncSelection();
    post('annotating', { enabled: enabled() });
    hint = enabled() && keyboard ? hintText : undefined;
    if (enabled() && keyboard) {
      candidates = [
        ...document.querySelectorAll(
          'h1,h2,h3,h4,p,li,td,th,img,a,button,input,select,textarea,label,[data-humagent-id],[role]',
        ),
      ]
        .filter((el) => !ignored(el) && el.getClientRects().length)
        .slice(0, 2000);
      cursor = -1;
      cursorAt(1);
    }
    render();
    schedule();
  }
  function showEditor(focus = true) {
    if (!captured) return;
    panelOpen = true;
    comment = captured.saved?.review.comment || '';
    view.setComment(comment);
    localError = '';
    updateEditor();
    position();
    if (focus) view.focusComment();
  }
  function anchor(el: Element, point?: Point): Point {
    const rect = el.getBoundingClientRect();
    return point
      ? { x: point.x - rect.left, y: point.y - rect.top }
      : { x: rect.width / 2, y: rect.height / 2 };
  }
  function center(el: Element | undefined): Point | undefined {
    const rect = el?.getBoundingClientRect();
    return rect?.width
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : undefined;
  }
  /** Open the comment panel on an element. No tool claimed the pick. */
  function show(el: EventTarget | null, range?: Range, point?: Point) {
    if (!(el instanceof Element) || ignored(el) || !writable || outside())
      return;
    const before = range ? range.toString() : textOf(el);
    if (before.length > LIMITS.text) {
      notice('Select a smaller section (maximum 50,000 characters).');
      return;
    }
    reopen();
    const target = targetOf(el);
    if (range) {
      const prefix = range.cloneRange(),
        suffix = range.cloneRange();
      prefix.selectNodeContents(el);
      prefix.setEnd(range.startContainer, range.startOffset);
      suffix.selectNodeContents(el);
      suffix.setStart(range.endContainer, range.endOffset);
      target.anchor = {
        quote: before,
        prefix: prefix.toString().slice(-32),
        suffix: suffix.toString().slice(0, 32),
      };
    }
    captured = { target, el, point: anchor(el, point) };
    showEditor();
  }
  /** Open a tool's inline editor for a claimed pick. The comment panel opens beside it. */
  function showTool(tool: RegisteredTool, hit: Hit, point?: Point) {
    if (!writable || outside()) return;
    reopen(hit.saved && view.marker(hit.saved.review.id));
    // The target and the press position describe the element before the editor changes it.
    const described = hit.saved?.review.target || targetOf(hit.el);
    const offset = anchor(hit.el, point);
    const editor = hit.open();
    captured = {
      target: hit.saved?.review.target || { ...described, ...editor.target },
      el: hit.el,
      ...(hit.saved ? { saved: hit.saved } : {}),
      point: offset,
      tool,
      editor,
    };
    if (editor.element) {
      const inline = editor.element;
      activeInput = inline;
      inline.onfocus = () => {
        activeInput = inline;
      };
    }
    showEditor(!editor.element);
  }
  /** Give a pick to the first tool that claims it. Without a claim, the pick opens a comment. */
  function pick(next: Pick) {
    for (const tool of tools) {
      const hit = tool.hit?.(next);
      if (hit === 'blocked') return;
      if (hit) return showTool(tool, hit, next.point);
    }
    show(next.el, next.range, next.point);
  }
  /** Whether a tool claims a press at this point. */
  const claims = (el: Element | undefined, point: Point) =>
    !!el &&
    tools.some((tool) => {
      const hit = tool.hit?.({ el, point });
      return !!hit && hit !== 'blocked';
    });
  /** Reopen a saved pending review. */
  function edit(reviewId: string, point?: Point) {
    const saved = pending.find((d) => d.review.id === reviewId);
    if (!saved || outside()) return;
    const el = resolve(saved);
    const tool = tools.find((t) => t.kind === saved.review.kind);
    const hit = el && tool?.hit?.({ el, saved });
    if (!el || hit === 'blocked') {
      notice('Target unavailable. Inspect or remove this review in the bar.');
      return;
    }
    if (tool && hit) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      showTool(tool, hit, point || center(view.marker(reviewId)));
      return;
    }
    reopen(view.marker(reviewId));
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    captured = {
      target: saved.review.target!,
      el,
      saved,
      point: anchor(el, point || center(view.marker(reviewId))),
    };
    showEditor();
  }
  function selectedText(point?: Point) {
    const selection = document.getSelection();
    if (!selection || !selection.rangeCount || !selection.toString().trim())
      return false;
    const range = selection.getRangeAt(0).cloneRange();
    const node = range.commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    if (ignored(el)) return false;
    if (!point) {
      const endpoint = range.cloneRange();
      endpoint.collapse(
        (selection as Selection & { direction?: string }).direction ===
          'backward' ||
          (selection.focusNode === range.startContainer &&
            selection.focusOffset === range.startOffset),
      );
      const rect = endpoint.getBoundingClientRect();
      if (rect.height) point = { x: rect.left, y: rect.bottom };
    }
    pick({ el: el as Element, range, ...(point ? { point } : {}) });
    return true;
  }
  async function save(remove = false) {
    if (!captured || saving || !writable) return;
    if (!remove && (!validInput() || (!!captured.saved && !changed()))) return;
    const el = findTarget(captured.target);
    if (!el) {
      localError = 'Target unavailable. Cancel this edit and inspect the page.';
      render();
      return;
    }
    captured.el = el;
    const current = captured;
    saving = true;
    updateEditor();
    try {
      if (remove && current.saved) await bridge.remove(current.saved.review.id);
      else if (current.saved) {
        // An edit keeps the kind. It takes the comment field and the built data.
        const data = build(current.target)?.data;
        await bridge.edit({
          reviewId: current.saved.review.id,
          comment,
          ...(data !== undefined ? { data } : {}),
        });
      } else {
        const targetRect = current.el.getBoundingClientRect();
        const coordinates = {
          x: Math.round(targetRect.left + current.point.x + scrollX),
          y: Math.round(targetRect.top + current.point.y + scrollY),
          space: 'document',
        };
        const review = build({ ...current.target, coordinates });
        if (!review) throw new Error('Add a comment or a change.');
        const local: MarkerLocal = {
          marker: { x: current.point.x, y: current.point.y },
        };
        await bridge.save(review, { local });
      }
      saving = false;
      close();
    } catch (error) {
      localError = errorMessage(error);
    } finally {
      saving = false;
      updateEditor();
    }
  }
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!enabled()) return;
      if (ownEvent(event)) return;
      if (captured || ignored(event.target)) return;
      hovered = event.target as Element;
      schedule();
    },
    { passive: true },
  );
  document.addEventListener('pointerleave', () => {
    if (!captured) {
      hovered = undefined;
      schedule();
    }
  });
  /** Classify a press: an inline editor, Humagent UI, a native control, or page content. */
  function source(event: Event): 'editor' | 'own' | 'control' | 'page' {
    const inline = captured?.editor?.element;
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
    const from = source(event);
    if (from === 'editor') return stop(event, event.type === 'click');
    if (from === 'own') return;
    const point = clickPoint(event);
    switch (event.type) {
      case 'pointerdown':
      case 'mousedown':
        if (changed()) stop(event, true);
        // A press on a control's plain label may start an inline editor, so only that keeps its default.
        else if (enabled() && from === 'control')
          stop(
            event,
            !claims(eventElement(event), {
              x: event.clientX,
              y: event.clientY,
            }),
          );
        return;
      case 'click': {
        if (markerPress || (captured && outside())) return stop(event, true);
        if (ignored(event.target) || !enabled()) return;
        stop(event, true);
        if (document.getSelection()?.toString().trim()) return;
        pick({
          el: (eventElement(event) || event.target) as Element,
          ...(point ? { point } : {}),
        });
        return;
      }
      case 'pointerup':
        if (enabled() && from === 'control') stop(event);
        return;
      case 'mouseup':
        if (!enabled()) return;
        // The selection settles only after the default mouseup action.
        if (!captured && !ignored(event.target))
          setTimeout(() => selectedText(point), 0);
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
      const from = source(event);
      if (from === 'editor') return stop(event);
      if (enabled() && !captured && event.shiftKey && from !== 'own')
        selectedText();
    },
    true,
  );
  function cursorAt(offset: number) {
    if (!candidates.length) return;
    cursor = (cursor + offset + candidates.length) % candidates.length;
    hovered = candidates[cursor];
    hovered?.scrollIntoView({ block: 'nearest' });
    hintText = `Element ${cursor + 1} of ${candidates.length}. Arrow keys move. Enter opens a review. Escape exits.`;
    if (hint !== undefined) hint = hintText;
    render();
    schedule();
  }
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        if (captured) {
          event.preventDefault();
          close();
        } else if (enabled()) {
          event.preventDefault();
          setMode(false);
        }
        return;
      }
      if (!enabled() || captured || ignored(event.target)) return;
      if (
        ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)
      ) {
        event.preventDefault();
        if (!candidates.length) setMode(true, true);
        else cursorAt(['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1);
        hint = hintText;
        render();
      } else if (event.key === 'Enter' && hovered) {
        event.preventDefault();
        pick({ el: hovered, keyboard: true });
      }
    },
    true,
  );
  function findTarget(target: Target): Element | null {
    try {
      const matches = target.id
        ? document.querySelectorAll(
            `[data-humagent-id="${CSS.escape(String(target.id))}"],#${CSS.escape(String(target.id))}`,
          )
        : document.querySelectorAll(String(target.selector || ''));
      if (matches.length !== 1 || ignored(matches[0]!)) return null;
      return matches[0]!;
    } catch {
      return null;
    }
  }
  function resolve(saved: SavedReview): Element | null {
    const target = saved.review.target;
    if (
      !target ||
      saved.revision !== boot.revision ||
      target.url !== boot.sourceUrl
    )
      return null;
    return findTarget(target);
  }

  function position() {
    scheduled = false;
    for (const tool of tools) tool.layout?.();
    const available: Availability[] = [];
    const layouts: {
      saved: SavedReview;
      index: number;
      rect: DOMRect;
    }[] = [];
    pending.forEach((saved, index) => {
      if (!saved.review.target) return;
      const el = resolve(saved);
      available.push({ id: saved.review.id, available: !!el });
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (inView(rect, innerHeight)) layouts.push({ saved, index, rect });
    });
    const target = captured ? findTarget(captured.target) : hovered;
    const highlighted = highlightedReview
      ? pending.find((saved) => saved.review.id === highlightedReview)
      : undefined;
    const highlightedTarget = highlighted ? resolve(highlighted) : target;
    const highlight = highlightedTarget?.isConnected
      ? highlightedTarget.getBoundingClientRect()
      : null;
    const editorAnchor =
      target === highlightedTarget
        ? highlight
        : target?.isConnected
          ? target.getBoundingClientRect()
          : null;
    const height = window.visualViewport?.height || innerHeight;
    const panelSize = view.measurePanel((width) =>
      bar && bar.x < width + 22
        ? Math.min(height - 24, bar.y - 22)
        : height - 24,
    );
    layout = {
      markers: layouts.map(({ saved, index, rect }) => {
        const number = String(index + 1);
        const name =
          tools.find((tool) => tool.kind === saved.review.kind)?.name ??
          saved.review.kind;
        return {
          id: saved.review.id,
          number,
          label: `Review ${number}: ${saved.review.comment || name}`,
          expanded: captured?.saved?.review.id === saved.review.id,
          highlighted: saved.review.id === highlightedReview,
          ...markerPoint(
            rect,
            (saved.local as MarkerLocal | undefined)?.marker,
          ),
        };
      }),
      ...(highlight
        ? {
            highlight: {
              left: highlight.left,
              top: highlight.top,
              width: highlight.width,
              height: highlight.height,
            },
          }
        : {}),
      ...(panelSize && editorAnchor && captured
        ? {
            panel: panelPoint(
              {
                x: editorAnchor.left + captured.point.x,
                y: editorAnchor.top + captured.point.y,
              },
              panelSize,
              { width: innerWidth, height },
              bar,
            ),
          }
        : layout.panel
          ? { panel: layout.panel }
          : {}),
    };
    render();
    const signature = JSON.stringify(available);
    if (signature !== lastAvailability) {
      lastAvailability = signature;
      post('availability', { items: available });
    }
    const scrollbars = {
      right: innerWidth - document.documentElement.clientWidth,
      bottom: innerHeight - document.documentElement.clientHeight,
    };
    if (JSON.stringify(scrollbars) !== lastScrollbars) {
      lastScrollbars = JSON.stringify(scrollbars);
      post('scrollbars', scrollbars);
    }
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(position);
    }
  }
  document.addEventListener('scroll', schedule, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.addEventListener('beforeunload', (event) => {
    if (!saving && !changed()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const observer = new MutationObserver((records) => {
    if (
      records.every(
        (record) =>
          record.target instanceof Element &&
          record.target.closest('[data-humagent-ui]') &&
          !record.target.closest('[data-humagent-text]'),
      )
    )
      return;
    schedule();
  });
  const observation = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'class',
      'style',
      'id',
      'data-humagent-id',
      'hidden',
      'role',
      'contenteditable',
      'href',
    ],
  };
  const selectionStyle = new CSSStyleSheet();
  selectionStyle.replaceSync(
    '*:not([data-humagent-ui],input,textarea,select,option){user-select:text!important;-webkit-user-select:text!important}',
  );
  observer.observe(document.body || document.documentElement, observation);
  // Pages can block text selection with CSS. Selection must work while annotating.
  function syncSelection() {
    const sheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== selectionStyle,
    );
    document.adoptedStyleSheets = enabled()
      ? [...sheets, selectionStyle]
      : sheets;
  }
  /** What page plugins use. */
  const api: Targeting = {
    resolve,
    input,
    confirm: () => void save(),
    cancel: () => close(),
  };
  return {
    api,
    register(kind: string, tool: Tool) {
      tools.push({ ...tool, kind });
    },
    outside,
    open: edit,
    highlight(reviewId?: string) {
      highlightedReview = reviewId;
      schedule();
    },
    setMode,
    present(presentation: Presentation) {
      bar = presentation.bar;
      // A new presentation may follow an attach. Report scrollbars again.
      lastScrollbars = '';
      pending = presentation.pending;
      writable = presentation.writable;
      const ids = new Set(pending.map((saved) => saved.review.id));
      if (highlightedReview && !ids.has(highlightedReview))
        highlightedReview = undefined;
      // A removed pending review loses its marker at once, not at the next positioning pass.
      layout = {
        ...layout,
        markers: layout.markers.filter((marker) => ids.has(marker.id)),
      };
      if (captured?.saved && !ids.has(captured.saved.review.id)) close(true);
      if (!writable) {
        syncSelection();
        post('annotating', { enabled: false });
      }
      for (const tool of tools) tool.layout?.();
      updateEditor();
      schedule();
    },
  };
}
