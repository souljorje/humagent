/**
 * Annotating on the page. The page owns geometry and temporary editors. The parent owns saved feedback.
 * Tools decide which kind of review a pick becomes. This module names no kind and builds no markup.
 */
import {
  describeTarget,
  findTarget,
  isNativeInteractiveControl,
  isTarget,
  resolveTarget,
} from './targets.js';
import {
  createOverlayView,
  type MarkerModel,
  type OverlayModel,
  type PanelModel,
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
import type { Annotating, Editor, Hit, Pick, Tool } from '../shared/plugin.js';
import { clickPoint } from '../shared/dom.js';
import { effect, signal } from '../shared/signal.js';
import { errorMessage } from '../shared/errors.js';
import type { MarkerLocal } from '../shared/marker.js';

interface AnnotatingBridge {
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
  /** The comment field's text. The view owns the field. This copy follows its input. */
  comment: string;
  error: string;
  saving: boolean;
}
const HINT = 'Arrow keys choose an element. Enter comments. Escape exits.';

function observeLayout(schedule: () => void) {
  document.addEventListener('scroll', schedule, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
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
  observer.observe(document.body || document.documentElement, {
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
  });
}

function enableTextSelection(enabled: () => boolean) {
  const selectionStyle = new CSSStyleSheet();
  selectionStyle.replaceSync(
    '*:not([data-humagent-ui],input,textarea,select,option){user-select:text!important;-webkit-user-select:text!important}',
  );
  // Pages can block text selection with CSS. Selection must work while annotating.
  effect(() => {
    const active = enabled();
    const sheets = document.adoptedStyleSheets;
    if (active === sheets.includes(selectionStyle)) return;
    document.adoptedStyleSheets = active
      ? [...sheets, selectionStyle]
      : sheets.filter((sheet) => sheet !== selectionStyle);
  });
}

export function createAnnotating(bridge: AnnotatingBridge) {
  const { boot, notice, post } = bridge;
  const tools: RegisteredTool[] = [];
  let pending: readonly SavedReview[] = [];
  const writable = signal(false);
  let captured: Capture | null = null,
    hovered: Element | undefined;
  let highlightedReview: string | undefined;
  let bar: Presentation['bar'] | undefined;
  // A marker press opens its editor, which can move the marker before the click.
  let markerPress = false;
  const annotating = signal(false);
  let scheduled = false;
  const enabled = () => annotating() && writable();
  /** The last report of each state, so the workspace hears about changes only. */
  const reported = new Map<string, string>();
  function report<M extends 'availability' | 'scrollbars' | 'editing'>(
    method: M,
    params: PageEvents[M],
  ) {
    const signature = JSON.stringify(params);
    if (reported.get(method) === signature) return;
    reported.set(method, signature);
    post(method, params);
  }
  let returnFocus: Element | null = null;
  let candidates: Element[] = [],
    cursor = -1;
  let outsideClicks = 0;
  /** The input that had focus last: the comment field or an inline editor. */
  let activeInput: HTMLElement | 'comment' | null = null;
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
      if (!captured) return;
      captured.comment = value;
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
      if (captured?.saving) return;
      if (captured && captured.saved?.review.id !== id) close();
      edit(id, point || center(view.marker(id)));
    },
  });

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
  const resolve = (saved: SavedReview) => resolveTarget(saved, boot);
  /**
   * The open editor builds the review first. Then a saved review asks only the tool of its kind.
   * A new review asks each tool in registry order.
   */
  function build(target: Target): NewReview | undefined {
    if (!captured) return undefined;
    const { editor, tool: owner, saved, comment } = captured;
    const fields = editor?.build(comment);
    if (fields && owner) return { ...fields, kind: owner.kind, target };
    if (saved) {
      if (editor) return undefined;
      const { kind } = saved.review;
      const tool = tools.find((tool) => tool.kind === kind);
      // A kind without its own builder can still change its comment.
      const review = tool?.build
        ? tool.build(comment)
        : comment.trim()
          ? { comment }
          : undefined;
      return review && { ...review, kind, target };
    }
    for (const tool of tools) {
      const review = tool.build?.(comment);
      if (review) return { ...review, kind: tool.kind, target };
    }
    return undefined;
  }
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
      !!build(captured.target)
    );
  }
  function input() {
    outsideClicks = 0;
    updateEditor();
  }
  function panelModel(): PanelModel | undefined {
    if (!captured) return;
    const readOnly = captured.saving || !writable();
    const confirmDisabled = readOnly || !validInput();
    return {
      existing: !!captured.saved,
      confirmLabel: captured.editor?.confirmLabel ?? 'Add comment',
      confirmDisabled,
      saveDisabled: confirmDisabled || (!!captured.saved && !changed()),
      readOnly,
      locked: !writable(),
      error: captured.error,
      position: layout.panel,
    };
  }
  function render() {
    view.update({
      panel: panelModel(),
      markers: layout.markers,
      pendingIds: pending.map((saved) => saved.review.id),
      highlight: layout.highlight,
      hint,
    });
  }
  function updateEditor() {
    report('editing', { dirty: unfinished() });
    captured?.editor?.setReadOnly(captured.saving || !writable());
    render();
    schedule();
  }
  function outside() {
    if (!captured) return false;
    if (unfinished()) {
      if (!captured.saving && ++outsideClicks >= 2) close();
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
    if (captured?.saving && !force) return;
    const closing = captured;
    captured = null;
    render();
    closing?.editor?.close();
    for (const tool of tools) tool.layout?.();
    outsideClicks = 0;
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
    annotating.set(value);
    post('annotating', { enabled: enabled() });
    hint = enabled() && keyboard ? hintText : undefined;
    if (enabled() && keyboard) {
      candidates = [
        ...document.querySelectorAll(
          'h1,h2,h3,h4,p,li,td,th,img,a,button,input,select,textarea,label,[data-humagent-id],[role]',
        ),
      ]
        .filter((el) => isTarget(el) && el.getClientRects().length)
        .slice(0, 2000);
      cursor = -1;
      cursorAt(1);
    }
    render();
    schedule();
  }
  function showEditor(
    capture: Omit<Capture, 'comment' | 'error' | 'saving'>,
    focus = true,
  ) {
    captured = {
      ...capture,
      comment: capture.saved?.review.comment || '',
      error: '',
      saving: false,
    };
    view.setComment(captured.comment);
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
  function show(el: Element, range?: Range, point?: Point) {
    if (!isTarget(el) || !writable() || outside()) return;
    const text = range ? range.toString() : textOf(el);
    if (text.length > LIMITS.text) {
      notice('Select a smaller section (maximum 50,000 characters).');
      return;
    }
    reopen();
    const target = describeTarget(
      el,
      boot.sourceUrl,
      range ? textOf(el) : text,
      range,
    );
    showEditor({ target, el, point: anchor(el, point) });
  }
  /** Open a tool's inline editor for a claimed pick. The comment panel opens beside it. */
  function showTool(tool: RegisteredTool, hit: Hit, point?: Point) {
    if (!writable() || outside()) return;
    reopen(hit.saved && view.marker(hit.saved.review.id));
    // The target and the press position describe the element before the editor changes it.
    const described =
      hit.saved?.review.target ||
      describeTarget(hit.el, boot.sourceUrl, textOf(hit.el));
    const offset = anchor(hit.el, point);
    const editor = hit.open();
    if (editor.element) {
      const inline = editor.element;
      activeInput = inline;
      inline.onfocus = () => {
        activeInput = inline;
      };
    }
    showEditor(
      {
        target: hit.saved?.review.target || { ...described, ...editor.target },
        el: hit.el,
        ...(hit.saved ? { saved: hit.saved } : {}),
        point: offset,
        tool,
        editor,
      },
      !editor.element,
    );
  }
  /** The first tool to claim or block a pick decides it. */
  function firstHit(next: Pick) {
    for (const tool of tools) {
      const hit = tool.hit?.(next);
      if (hit) return { tool, hit };
    }
  }
  function pick(next: Pick) {
    const match = firstHit(next);
    if (!match) return show(next.el, next.range, next.point);
    if (match.hit !== 'blocked') showTool(match.tool, match.hit, next.point);
  }
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
    showEditor({
      target: saved.review.target!,
      el,
      saved,
      point: anchor(el, point || center(view.marker(reviewId))),
    });
  }
  function selectedText(point?: Point) {
    const selection = document.getSelection();
    if (!selection || !selection.rangeCount || !selection.toString().trim())
      return false;
    const range = selection.getRangeAt(0).cloneRange();
    const node = range.commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    if (!isTarget(el)) return false;
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
    pick({ el, range, ...(point ? { point } : {}) });
    return true;
  }
  async function save(remove = false) {
    if (!captured || captured.saving || !writable()) return;
    if (!remove && (!validInput() || (!!captured.saved && !changed()))) return;
    const el = findTarget(captured.target);
    if (!el) {
      captured.error =
        'Target unavailable. Cancel this edit and inspect the page.';
      render();
      return;
    }
    captured.el = el;
    const current = captured;
    current.saving = true;
    updateEditor();
    try {
      if (remove && current.saved) await bridge.remove(current.saved.review.id);
      else if (current.saved) {
        // An edit keeps the kind. It takes the comment field and the built data.
        const data = build(current.target)?.data;
        await bridge.edit({
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
        const review = build({ ...current.target, coordinates });
        if (!review) throw new Error('Add a comment or a change.');
        const local: MarkerLocal = {
          marker: { x: current.point.x, y: current.point.y },
        };
        await bridge.save(review, { local });
      }
      current.saving = false;
      // A presentation can close this editor during the save. Another editor can be open now.
      if (captured === current) close();
    } catch (error) {
      current.error = errorMessage(error);
    } finally {
      current.saving = false;
      updateEditor();
    }
  }
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!enabled()) return;
      if (ownEvent(event)) return;
      if (captured || !isTarget(event.target)) return;
      hovered = event.target;
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
        else if (enabled() && from === 'control') {
          const el = eventElement(event);
          const match =
            el &&
            firstHit({ el, point: { x: event.clientX, y: event.clientY } });
          stop(event, !match || match.hit === 'blocked');
        }
        return;
      case 'click': {
        if (markerPress || (captured && outside())) return stop(event, true);
        if (!isTarget(event.target) || !enabled()) return;
        stop(event, true);
        if (document.getSelection()?.toString().trim()) return;
        pick({
          el: event.target,
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
        if (!captured && isTarget(event.target))
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
  function keydown(event: KeyboardEvent) {
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
    if (!enabled() || captured || !isTarget(event.target)) return;
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
  }
  document.addEventListener('keydown', keydown, true);
  function reviewMarkers() {
    const available: Availability[] = [];
    const markers: MarkerModel[] = [];
    for (const [index, saved] of pending.entries()) {
      if (!saved.review.target) continue;
      const el = resolve(saved);
      const { id, kind, comment } = saved.review;
      available.push({ id, available: !!el });
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (!inView(rect, innerHeight)) continue;
      const number = String(index + 1);
      const label =
        comment || (tools.find((tool) => tool.kind === kind)?.name ?? kind);
      markers.push({
        id,
        number,
        label: `Review ${number}: ${label}`,
        expanded: captured?.saved?.review.id === id,
        highlighted: id === highlightedReview,
        ...markerPoint(rect, (saved.local as MarkerLocal | undefined)?.marker),
      });
    }
    return { available, markers };
  }
  function position() {
    scheduled = false;
    for (const tool of tools) tool.layout?.();
    const { available, markers } = reviewMarkers();
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
      markers,
      highlight: highlight ?? undefined,
      panel:
        panelSize && editorAnchor && captured
          ? panelPoint(
              {
                x: editorAnchor.left + captured.point.x,
                y: editorAnchor.top + captured.point.y,
              },
              panelSize,
              { width: innerWidth, height },
              bar,
            )
          : layout.panel,
    };
    render();
    report('availability', { items: available });
    report('scrollbars', {
      right: innerWidth - document.documentElement.clientWidth,
      bottom: innerHeight - document.documentElement.clientHeight,
    });
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(position);
    }
  }
  observeLayout(schedule);
  window.addEventListener('beforeunload', (event) => {
    if (!unfinished()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  enableTextSelection(enabled);
  /** What page plugins use. */
  const api: Annotating = {
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
      reported.delete('scrollbars');
      pending = presentation.pending;
      writable.set(presentation.writable);
      const ids = new Set(pending.map((saved) => saved.review.id));
      if (highlightedReview && !ids.has(highlightedReview))
        highlightedReview = undefined;
      // A removed pending review loses its marker at once, not at the next positioning pass.
      layout = {
        ...layout,
        markers: layout.markers.filter((marker) => ids.has(marker.id)),
      };
      if (captured?.saved && !ids.has(captured.saved.review.id)) close(true);
      if (!presentation.writable) post('annotating', { enabled: false });
      updateEditor();
      schedule();
    },
  };
}
