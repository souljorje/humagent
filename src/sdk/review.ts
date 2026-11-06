import { context, isNativeInteractiveControl } from './targets.js';
import { createReviewView } from './review-view.js';
import {
  createTextEditing,
  selectedRun,
  isEditableText,
} from './text-editing.js';
import { createCommentCursor } from './comment-cursor.js';
import { hitTestText } from './text-hit.js';
import type {
  Bootstrap,
  ReviewPresentation,
  Requests,
} from '../shared/bridge.js';
import type { DraftItem, ReviewTarget } from '../shared/batch.js';
import type { Availability, Draft, StageResult } from '../shared/review.js';
import { errorMessage } from '../shared/errors.js';

interface ReviewBridge {
  boot: Bootstrap;
  stage(item: DraftItem): Promise<StageResult>;
  edit(params: Requests['edit']['params']): Promise<unknown>;
  remove(draftId: string): Promise<unknown>;
  notice(message: string): void;
  availability(items: Availability[]): void;
  mode(enabled: boolean): void;
  editing(dirty: boolean): void;
}
interface Capture {
  target: ReviewTarget;
  before: string;
  el: Element;
  draft?: Draft;
  point: Point;
}
interface Point {
  x: number;
  y: number;
}

/** The page owns geometry and temporary editors. The parent owns saved feedback. */
export function createPageReview(bridge: ReviewBridge) {
  const { boot, stage, notice, availability } = bridge;
  const { $ } = createReviewView();
  const anchors = new Map<string, Element>();
  const bound = new Map<string, Element | null>();
  const markers = new Map<string, HTMLButtonElement>();
  let drafts: Draft[] = [],
    previews: Draft[] = [],
    locked = new Set<string>(),
    writable = false;
  let captured: Capture | null = null,
    hovered: Element | undefined;
  let enabled = false,
    replacement = false,
    saving = false,
    scheduled = false;
  let lastAvailability = '',
    lastDirty = false;
  let returnFocus: Element | null = null;
  let candidates: Element[] = [],
    cursor = -1;
  let outsideClicks = 0;
  let activeInput: HTMLElement | null = null;
  const text = createTextEditing({
    resolve,
    input,
    confirm: () => void save(),
    cancel,
    invalidate: schedule,
  });
  function canEditText(node: Node | null): node is Text {
    if (!writable || !isEditableText(node)) return false;
    const existing = text.existing(node);
    return (
      !existing ||
      (drafts.some((draft) => draft.item.id === existing.item.id) &&
        !locked.has(existing.item.id))
    );
  }
  const commentCursor = createCommentCursor((root) => {
    observer.observe(root, observation);
    observed.add(root);
    shadowRoots.add(root);
  }, canEditText);
  const ignored = (el: EventTarget | null) =>
    !(el instanceof Element) ||
    el.closest('[data-humagent-ui],script,style,head') ||
    el === document.documentElement;
  const eventElement = (event: Event) =>
    event.composedPath().find((item) => item instanceof Element) as
      | Element
      | undefined;
  const ownEvent = (event: Event) =>
    event
      .composedPath()
      .some(
        (item) => item instanceof Element && item.matches('[data-humagent-ui]'),
      );
  const exactText = text.canonicalText;
  function targetContext(el: Element) {
    return context(el, exactText(el));
  }
  function matchesTarget(el: Element, target: ReviewTarget) {
    const current = targetContext(el);
    return (
      current.text === target.text &&
      (target.id === undefined || current.id === String(target.id)) &&
      JSON.stringify(current.shadowPath || []) ===
        JSON.stringify(target.shadowPath || [])
    );
  }
  const isEditor = () => !$('panel').hidden || !!text.element;
  const mutable = () =>
    writable && (!captured?.draft || !locked.has(captured.draft.item.id));
  function changed() {
    if (!captured || !isEditor()) return false;
    const commentChanged = captured.draft
      ? $('note').value !== (captured.draft.item.comment || '')
      : !!$('note').value;
    return commentChanged || (replacement && text.value !== text.initial);
  }
  function validInput() {
    return replacement
      ? text.connected &&
          text.value.length <= 50000 &&
          (!!captured?.draft ||
            text.value !== captured?.before ||
            !!$('note').value.trim())
      : !!$('note').value.trim();
  }
  function input() {
    outsideClicks = 0;
    updateEditor();
  }
  function updateEditor() {
    const dirty = saving || changed();
    if (lastDirty !== dirty) {
      lastDirty = dirty;
      bridge.editing(dirty);
    }
    const valid = validInput();
    $('confirm').disabled = saving || !mutable() || !valid;
    $('save').disabled =
      saving || !mutable() || !valid || (!!captured?.draft && !changed());
    $('remove').disabled = saving || !mutable();
    $('note').readOnly = saving || !mutable();
    text.setReadOnly(saving || !mutable());
    $('editor-status').hidden = mutable();
    $('editor-status').textContent = locked.has(captured?.draft?.item.id || '')
      ? 'Awaiting confirmation'
      : 'Read only';
    for (const textarea of [$('note')]) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(136, textarea.scrollHeight)}px`;
    }
    schedule();
  }
  function flush() {
    if (saving || changed()) throw new Error('Feedback is not confirmed.');
  }
  function outside() {
    if (!captured) return false;
    if (saving || changed()) {
      if (!saving && ++outsideClicks >= 2) close();
      else {
        const editor = activeInput?.isConnected
          ? activeInput
          : text.element || $('note');
        editor.focus({ preventScroll: true });
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const surface = $('panel');
          surface.getAnimations().forEach((animation) => animation.cancel());
          surface.animate(
            [
              { translate: '0' },
              { translate: '-4px' },
              { translate: '4px' },
              { translate: '0' },
            ],
            { duration: 180 },
          );
        }
      }
      return true;
    }
    close();
    return false;
  }
  function close(force = false) {
    if (saving && !force) return;
    $('panel').hidden = true;
    text.close();
    text.reconcile(previews);
    outsideClicks = 0;
    if (
      captured &&
      !drafts.some((d) => d.item.target?.anchorId === captured!.target.anchorId)
    )
      anchors.delete(String(captured.target.anchorId));
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
  function cancel() {
    close();
  }
  function setMode(value: boolean, keyboard = false) {
    if (outside()) {
      bridge.mode(enabled);
      return;
    }
    close();
    enabled = value && writable;
    commentCursor.set(enabled);
    bridge.mode(enabled);
    $('keyboard-hint').hidden = !enabled || !keyboard;
    if (enabled && keyboard) {
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
    schedule();
  }
  function showEditor(focus = true) {
    if (!captured) return;
    $('panel').hidden = false;
    const existing = captured.draft?.item;
    $('note').value = existing?.comment || '';
    $('note').placeholder = replacement
      ? 'Add a comment (optional)…'
      : 'Add a comment…';
    $('confirm').setAttribute(
      'aria-label',
      replacement ? 'Confirm text edit' : 'Add comment',
    );
    $('confirm').hidden = !!existing;
    $('actions').hidden = !existing;
    $('remove').hidden = !existing;
    $('local-error').hidden = true;
    updateEditor();
    position();
    if (focus) $('note').focus({ preventScroll: true });
  }
  function anchor(el: Element, point?: Point): Point {
    const rect = el.getBoundingClientRect();
    return point
      ? { x: point.x - rect.left, y: point.y - rect.top }
      : { x: rect.width / 2, y: rect.height / 2 };
  }
  function clickPoint(event: MouseEvent): Point | undefined {
    return (event.isTrusted && event.detail > 0) ||
      event.clientX ||
      event.clientY
      ? { x: event.clientX, y: event.clientY }
      : undefined;
  }
  function center(el: Element | undefined): Point | undefined {
    const rect = el?.getBoundingClientRect();
    return rect?.width
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : undefined;
  }
  function show(el: EventTarget | null, range?: Range, point?: Point) {
    if (!(el instanceof Element) || ignored(el) || !writable || outside())
      return;
    const before = range ? range.toString() : exactText(el);
    if (before.length > 50000) {
      notice('Select a smaller section (maximum 50,000 characters).');
      return;
    }
    close();
    returnFocus = document.activeElement;
    const target: ReviewTarget = {
      ...targetContext(el),
      url: boot.sourceUrl,
      revision: boot.revision,
      anchorId: crypto.randomUUID(),
    };
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
    anchors.set(String(target.anchorId), el);
    watchRoots(el);
    captured = { target, before, el, point: anchor(el, point) };
    replacement = false;
    showEditor();
  }
  function showText(
    node: Text,
    start: number,
    end: number,
    draft?: Draft,
    point?: Point,
  ) {
    const el = node.parentElement!;
    const existing = draft || text.existing(node);
    if (
      existing &&
      !draft &&
      (!drafts.some((draft) => draft.item.id === existing.item.id) ||
        locked.has(existing.item.id))
    )
      return;
    if (!writable || outside()) return;
    close();
    returnFocus = existing
      ? markers.get(existing.item.id) || document.activeElement
      : document.activeElement;
    const before = existing?.item.replacement?.before ?? node.data;
    if (!before.trim() || before.length > 50000) return;
    const target: ReviewTarget = existing?.item.target || {
      ...targetContext(el),
      url: boot.sourceUrl,
      revision: boot.revision,
      anchorId: crypto.randomUUID(),
      textNode: [...el.childNodes].indexOf(node),
      anchor: { quote: before },
    };
    anchors.set(String(target.anchorId), el);
    watchRoots(el);
    captured = {
      target,
      before,
      el,
      draft: existing,
      point: anchor(el, point),
    };
    replacement = true;
    text.open(node, start, end, before);
    activeInput = text.element!;
    text.element!.onfocus = () => {
      activeInput = text.element!;
    };
    showEditor(false);
  }
  function edit(draftId: string, point?: Point) {
    const draft = drafts.find((d) => d.item.id === draftId);
    if (!draft || outside()) return;
    const el = resolve(draft);
    if (!el) {
      notice(
        'Target unavailable. Inspect or remove this feedback in pending items.',
      );
      return;
    }
    if (draft.item.replacement) {
      const node = text.nodeFor(draft, el);
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (node)
        showText(
          node,
          0,
          node.length,
          draft,
          point || center(markers.get(draftId)),
        );
      return;
    }
    close();
    returnFocus = markers.get(draftId) || document.activeElement;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    captured = {
      target: draft.item.target!,
      before: exactText(el),
      el,
      draft,
      point: anchor(el, point || center(markers.get(draftId))),
    };
    replacement = false;
    showEditor();
  }
  function selectedText(point?: Point) {
    const selection = document.getSelection();
    if (!selection || !selection.rangeCount || !selection.toString().trim())
      return false;
    let range = selection.getRangeAt(0).cloneRange();
    // Native Selection ranges are retargeted at shadow hosts in some browsers.
    const composed = selection as Selection & {
      getComposedRanges?: (options: {
        shadowRoots: ShadowRoot[];
      }) => StaticRange[];
    };
    if (composed.getComposedRanges) {
      const ranges = composed.getComposedRanges({
        shadowRoots: [...shadowRoots],
      });
      const current = ranges[0];
      if (current) {
        range = document.createRange();
        range.setStart(current.startContainer, current.startOffset);
        range.setEnd(current.endContainer, current.endOffset);
      }
    }
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
    const run = selectedRun(range);
    if (run && isEditableText(run.node)) {
      if (canEditText(run.node))
        showText(run.node, run.start, run.end, undefined, point);
    } else show(el, range, point);
    return true;
  }
  $('cancel').onclick = cancel;
  $('note').oninput = input;
  $('note').onfocus = () => {
    activeInput = $('note');
  };
  async function save(remove = false) {
    if (!captured || saving || !mutable()) return;
    if (!remove && (!validInput() || (!!captured.draft && !changed()))) return;
    if (
      !captured.el.isConnected ||
      !matchesTarget(captured.el, captured.target)
    ) {
      const output = $('local-error');
      output.textContent =
        'Target changed. Cancel this edit and inspect the page.';
      output.hidden = false;
      return;
    }
    const current = captured;
    saving = true;
    updateEditor();
    try {
      if (remove && current.draft) await bridge.remove(current.draft.item.id);
      else if (current.draft)
        await bridge.edit({
          draftId: current.draft.item.id,
          comment: $('note').value,
          ...(replacement ? { after: text.value } : {}),
        });
      else
        await stage({
          target: current.target,
          ...($('note').value.trim() ? { comment: $('note').value } : {}),
          ...(replacement && text.value !== current.before
            ? {
                replacement: {
                  before: current.before,
                  after: text.value,
                },
              }
            : {}),
        });
      saving = false;
      close();
    } catch (error) {
      const output = $('local-error');
      output.textContent = errorMessage(error);
      output.hidden = false;
    } finally {
      saving = false;
      updateEditor();
    }
  }
  $('editor').onsubmit = (event) => {
    event.preventDefault();
    if (!($('confirm').hidden ? $('save').disabled : $('confirm').disabled))
      void save();
  };
  $('remove').onclick = () => void save(true);
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!enabled) return;
      if (ownEvent(event)) {
        commentCursor.clear();
        return;
      }
      commentCursor.move(event.clientX, event.clientY);
      if (captured || ignored(event.target)) return;
      hovered = event
        .composedPath()
        .find((item) => item instanceof Element && !ignored(item)) as
        | Element
        | undefined;
      if (hovered) watchRoots(hovered);
      schedule();
    },
    { passive: true },
  );
  document.addEventListener('pointerleave', () => {
    commentCursor.clear();
    if (!captured) {
      hovered = undefined;
      schedule();
    }
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (ownEvent(event)) return;
      if (
        changed() ||
        (enabled &&
          !ignored(event.target) &&
          isNativeInteractiveControl(eventElement(event) || null))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (ownEvent(event)) return;
      if (captured && outside()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (ignored(event.target)) return;
      if (!enabled) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const selection = document.getSelection();
      if (selection?.toString().trim()) return;
      const point = clickPoint(event);
      const hit = point
        ? hitTestText(point, shadowRoots, canEditText)?.text
        : undefined;
      if (hit) showText(hit.node, hit.offset, hit.offset, undefined, point);
      else show(eventElement(event) || event.target, undefined, point);
    },
    true,
  );
  document.addEventListener('mouseup', (event) => {
    if (
      enabled &&
      !captured &&
      !ownEvent(event) &&
      !ignored(event.target) &&
      !isNativeInteractiveControl(event.target)
    )
      setTimeout(() => selectedText(clickPoint(event)), 0);
  });
  document.addEventListener('keyup', (event) => {
    if (enabled && !captured && event.shiftKey && !ownEvent(event))
      selectedText();
  });
  function cursorAt(offset: number) {
    if (!candidates.length) return;
    cursor = (cursor + offset + candidates.length) % candidates.length;
    hovered = candidates[cursor];
    hovered?.scrollIntoView({ block: 'nearest' });
    $('keyboard-hint').textContent =
      `Element ${cursor + 1} of ${candidates.length}. Arrow keys move. Enter comments. Escape exits.`;
    schedule();
  }
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        if (captured) {
          event.preventDefault();
          cancel();
        } else if (enabled) {
          event.preventDefault();
          setMode(false);
        }
        return;
      }
      if (!enabled || captured || ignored(event.target)) return;
      if (
        ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)
      ) {
        event.preventDefault();
        if (!candidates.length) setMode(true, true);
        else cursorAt(['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1);
        $('keyboard-hint').hidden = false;
      } else if (event.key === 'Enter' && hovered) {
        event.preventDefault();
        const nodes = [...hovered.childNodes].filter(canEditText);
        if (nodes.length === 1)
          showText(nodes[0]!, nodes[0]!.length, nodes[0]!.length);
        else show(hovered);
      }
    },
    true,
  );
  function resolve(draft: Draft): Element | null {
    const target = draft.item.target;
    if (
      !target ||
      text.unavailable(draft.item.id) ||
      draft.revision !== boot.revision ||
      target.url !== boot.sourceUrl
    )
      return null;
    const anchor = target.anchor;
    const quote =
      anchor && typeof anchor === 'object' && !Array.isArray(anchor)
        ? anchor.quote
        : undefined;
    let el = bound.has(draft.item.id)
      ? bound.get(draft.item.id)
      : typeof target.anchorId === 'string'
        ? anchors.get(target.anchorId)
        : undefined;
    if (el === null) return null;
    if (el && !el.isConnected) {
      bound.set(draft.item.id, null);
      return null;
    }
    if (!el) {
      try {
        let root: Document | ShadowRoot = document;
        if (Array.isArray(target.shadowPath)) {
          for (const selector of target.shadowPath) {
            const hosts: NodeListOf<Element> = root.querySelectorAll(
              String(selector),
            );
            if (hosts.length !== 1 || !hosts[0]!.shadowRoot) return null;
            root = hosts[0]!.shadowRoot!;
          }
        }
        const matches = target.id
          ? root.querySelectorAll(
              `[data-humagent-id="${CSS.escape(String(target.id))}"],#${CSS.escape(String(target.id))}`,
            )
          : root.querySelectorAll(String(target.selector || ''));
        if (matches.length !== 1) return null;
        el = matches[0];
      } catch {
        return null;
      }
    }
    if (!el || ignored(el)) return null;
    if (!matchesTarget(el, target)) return null;
    if (anchor && !exactText(el).includes(String(quote))) return null;
    bound.set(draft.item.id, el);
    watchRoots(el);
    return el;
  }

  function place(el: HTMLElement, x: number, y: number) {
    el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }
  function position() {
    scheduled = false;
    text.reconcile(previews);
    if (text.element && !text.connected) {
      $('confirm').disabled = $('save').disabled = true;
      $('local-error').hidden = false;
      $('local-error').textContent =
        'Target changed. Cancel this edit and inspect the page.';
    }
    const available: Availability[] = [];
    const layouts: {
      draft: Draft;
      index: number;
      rect: DOMRect;
      offset: number;
    }[] = [];
    const offsets = new Map<Element, number>();
    drafts.forEach((draft, index) => {
      if (!draft.item.target) return;
      const el = resolve(draft);
      available.push({ id: draft.item.id, available: !!el });
      if (!el) return;
      const rect = el.getBoundingClientRect(),
        offset = offsets.get(el) || 0;
      offsets.set(el, offset + 1);
      if (
        (rect.width || rect.height) &&
        rect.bottom >= 0 &&
        rect.top <= innerHeight
      )
        layouts.push({ draft, index, rect, offset });
    });
    const target = captured
      ? matchesTarget(captured.el, captured.target)
        ? captured.el
        : undefined
      : hovered;
    const highlight = target?.isConnected
      ? target.getBoundingClientRect()
      : null;
    const panel = !$('panel').hidden ? $('panel') : null;
    const panelRect = panel?.getBoundingClientRect();
    const visible = new Set(layouts.map((layout) => layout.draft.item.id));
    for (const [id, marker] of markers) marker.hidden = !visible.has(id);
    for (const { draft, index, rect, offset } of layouts) {
      let marker = markers.get(draft.item.id);
      if (!marker) {
        marker = document.createElement('button');
        marker.className = 'marker';
        marker.dataset.draftId = draft.item.id;
        marker.onclick = (event) =>
          edit(draft.item.id, clickPoint(event) || center(marker));
        markers.set(draft.item.id, marker);
        $('markers').append(marker);
      }
      marker.hidden = false;
      marker.textContent = String(index + 1);
      marker.setAttribute(
        'aria-label',
        `Comment ${index + 1}: ${draft.item.comment || 'Text edit'}`,
      );
      marker.setAttribute(
        'aria-expanded',
        String(captured?.draft?.item.id === draft.item.id),
      );
      place(
        marker,
        Math.max(6, Math.min(rect.right - 16 - offset * 38, innerWidth - 38)),
        Math.max(6, Math.min(rect.top - 16, innerHeight - 38)),
      );
    }
    $('highlight').hidden = !highlight;
    if (highlight) {
      place($('highlight'), highlight.left, highlight.top);
      $('highlight').style.width = `${highlight.width}px`;
      $('highlight').style.height = `${highlight.height}px`;
    }
    if (panel && panelRect && highlight && captured) {
      const viewportHeight = window.visualViewport?.height || innerHeight;
      const point = {
        x: highlight.left + captured.point.x,
        y: highlight.top + captured.point.y,
      };
      const preferredX =
        point.x + 10 + panelRect.width <= innerWidth - 12
          ? point.x + 10
          : point.x - panelRect.width - 10;
      const x = Math.max(
        12,
        Math.min(preferredX, innerWidth - panelRect.width - 12),
      );
      const preferredY =
        point.y + 10 + panelRect.height <= viewportHeight - 12
          ? point.y + 10
          : point.y - panelRect.height - 10;
      const y = Math.max(
        12,
        Math.min(preferredY, viewportHeight - panelRect.height - 12),
      );
      panel.style.left = `${Math.round(x)}px`;
      panel.style.top = `${Math.round(y)}px`;
    }
    const signature = JSON.stringify(available);
    if (signature !== lastAvailability) {
      lastAvailability = signature;
      availability(available);
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
    try {
      flush();
    } catch {
      event.preventDefault();
      event.returnValue = '';
    }
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
    if (enabled) commentCursor.discover();
    schedule();
  });
  const observed = new WeakSet<ShadowRoot>();
  const shadowRoots = new Set<ShadowRoot>();
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
  observer.observe(document.body || document.documentElement, observation);
  function watchRoots(el: Element) {
    commentCursor.watch(el);
    let root = el.getRootNode();
    while (root instanceof ShadowRoot) {
      if (!observed.has(root)) {
        observer.observe(root, observation);
        observed.add(root);
        shadowRoots.add(root);
      }
      root = root.host.getRootNode();
    }
  }
  return {
    flush,
    outside,
    edit,
    setMode,
    end() {
      enabled = false;
      commentCursor.set(false);
      writable = false;
      bridge.mode(false);
      updateEditor();
      schedule();
    },
    setDrafts(presentation: ReviewPresentation) {
      drafts = presentation.items;
      previews = presentation.previews;
      locked = new Set(presentation.locked);
      writable = presentation.writable;
      const ids = new Set(drafts.map((draft) => draft.item.id));
      const previewIds = new Set(previews.map((draft) => draft.item.id));
      const references = new Set(
        [...drafts, ...previews].map((draft) => draft.item.target?.anchorId),
      );
      for (const id of bound.keys())
        if (!ids.has(id) && !previewIds.has(id)) bound.delete(id);
      for (const [id, marker] of markers)
        if (!ids.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      for (const id of anchors.keys())
        if (!references.has(id) && id !== captured?.target.anchorId)
          anchors.delete(id);
      if (captured?.draft && !ids.has(captured.draft.item.id)) close(true);
      if (!writable) {
        enabled = false;
        commentCursor.set(false);
      }
      text.reconcile(previews);
      updateEditor();
      schedule();
    },
  };
}
