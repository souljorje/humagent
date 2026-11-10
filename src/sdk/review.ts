import { context, isNativeInteractiveControl } from './targets.js';
import { createReviewView } from './review-view.js';
import {
  createTextEditing,
  selectedRun,
  isEditableText,
} from './text-editing.js';
import { hitTestText } from './text-hit.js';
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
  type Draft,
  type ReviewTarget,
} from '../shared/feedback.js';
import { errorMessage } from '../shared/errors.js';
import { cloneJson } from '../shared/json.js';

interface ReviewBridge {
  boot: Bootstrap;
  request<M extends keyof Requests>(
    method: M,
    params: Requests[M]['params'],
  ): Promise<Requests[M]['result']>;
  notice(message: string): void;
  post<M extends keyof PageEvents>(method: M, params: PageEvents[M]): void;
}
interface Capture {
  target: ReviewTarget;
  before: string;
  el: Element;
  draft?: Draft;
  point: Point;
  /** The editor proposes a text replacement, not only a comment. */
  text?: boolean;
}

/** The page owns geometry and temporary editors. The parent owns saved feedback. */
export function createPageReview(bridge: ReviewBridge) {
  const { boot, request, notice, post } = bridge;
  const { $ } = createReviewView();
  const markers = new Map<string, HTMLButtonElement>();
  let drafts: Draft[] = [],
    previews: Draft[] = [],
    writable = false;
  let captured: Capture | null = null,
    hovered: Element | undefined;
  let highlightedDraft: string | undefined;
  let annotating = false,
    saving = false,
    scheduled = false;
  const enabled = () => annotating && writable;
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
    cancel: () => close(),
  });
  function canEditText(node: Node | null): node is Text {
    if (!writable || !isEditableText(node)) return false;
    const existing = text.existing(node);
    return (
      !existing || drafts.some((draft) => draft.item.id === existing.item.id)
    );
  }
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
  function changed() {
    if (!captured || ($('panel').hidden && !text.element)) return false;
    const commentChanged = captured.draft
      ? $('note').value !== (captured.draft.item.comment || '')
      : !!$('note').value;
    return commentChanged || (!!captured.text && text.value !== text.initial);
  }
  function validInput() {
    return captured?.text
      ? text.value.length <= LIMITS.text &&
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
      post('editing', { dirty });
    }
    const valid = validInput();
    $('confirm').disabled = saving || !writable || !valid;
    $('save').disabled =
      saving || !writable || !valid || (!!captured?.draft && !changed());
    $('remove').disabled = saving || !writable;
    $('note').readOnly = saving || !writable;
    text.setReadOnly(saving || !writable);
    $('editor-status').hidden = writable;
    $('editor-status').textContent = 'Read only';
    $('note').style.height = 'auto';
    $('note').style.height = `${Math.min(136, $('note').scrollHeight)}px`;
    schedule();
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
  function capture(next: Omit<Capture, 'point'>, point?: Point) {
    captured = { ...next, point: anchor(next.el, point) };
  }
  function setMode(value: boolean, keyboard = false) {
    if (outside()) {
      post('mode', { enabled: enabled() });
      return;
    }
    close();
    annotating = value;
    syncSelection();
    post('mode', { enabled: enabled() });
    $('keyboard-hint').hidden = !enabled() || !keyboard;
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
    schedule();
  }
  function showEditor(focus = true) {
    if (!captured) return;
    $('panel').hidden = false;
    const existing = captured.draft?.item;
    $('note').value = existing?.comment || '';
    $('note').placeholder = 'Add a comment…';
    $('confirm').setAttribute(
      'aria-label',
      captured.text ? 'Confirm text edit' : 'Add comment',
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
    if (before.length > LIMITS.text) {
      notice('Select a smaller section (maximum 50,000 characters).');
      return;
    }
    reopen();
    const target: ReviewTarget = {
      ...context(el, exactText(el)),
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
    capture({ target, before, el }, point);
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
      !drafts.some((draft) => draft.item.id === existing.item.id)
    )
      return;
    if (!writable || outside()) return;
    reopen(existing && markers.get(existing.item.id));
    const before = existing?.item.replacement?.before ?? node.data;
    if (!before.trim() || before.length > LIMITS.text) return;
    const target: ReviewTarget = existing?.item.target || {
      ...context(el, exactText(el)),
      url: boot.sourceUrl,
      revision: boot.revision,
      anchorId: crypto.randomUUID(),
      textNode: [...el.childNodes].indexOf(node),
      anchor: { quote: before },
    };
    capture({ target, before, el, draft: existing, text: true }, point);
    text.open(
      node,
      start,
      draft ? (existing?.item.replacement?.after.length ?? end) : end,
      before,
      existing?.item.replacement?.after,
    );
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
      if (node) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        showText(
          node,
          0,
          node.length,
          draft,
          point || center(markers.get(draftId)),
        );
        return;
      }
    }
    reopen(markers.get(draftId));
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    capture(
      { target: draft.item.target!, before: exactText(el), el, draft },
      point || center(markers.get(draftId)),
    );
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
    const run = selectedRun(range);
    if (run && isEditableText(run.node)) {
      if (canEditText(run.node))
        showText(run.node, run.start, run.end, undefined, point);
    } else show(el, range, point);
    return true;
  }
  $('cancel').onclick = () => close();
  $('note').oninput = input;
  $('note').onkeydown = (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void save();
    }
  };
  $('note').onfocus = () => {
    activeInput = $('note');
  };
  async function save(remove = false) {
    if (!captured || saving || !writable) return;
    if (!remove && (!validInput() || (!!captured.draft && !changed()))) return;
    const el = findTarget(captured.target);
    if (!el) {
      $('local-error').textContent =
        'Target unavailable. Cancel this edit and inspect the page.';
      $('local-error').hidden = false;
      return;
    }
    captured.el = el;
    const current = captured;
    saving = true;
    updateEditor();
    try {
      if (remove && current.draft)
        await request('remove', { draftId: current.draft.item.id });
      else if (current.draft)
        await request('edit', {
          draftId: current.draft.item.id,
          comment: $('note').value,
          ...(current.text ? { after: text.value } : {}),
        });
      else {
        const targetRect = current.el.getBoundingClientRect();
        const coordinates = {
          x: Math.round(targetRect.left + current.point.x + scrollX),
          y: Math.round(targetRect.top + current.point.y + scrollY),
          space: 'document',
        };
        await request('stage', {
          item: cloneJson({
            target: { ...current.target, coordinates },
            ...($('note').value.trim() ? { comment: $('note').value } : {}),
            ...(current.text && text.value !== current.before
              ? { replacement: { before: current.before, after: text.value } }
              : {}),
          }),
          marker: current.point,
        });
      }
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
    void save();
  };
  $('remove').onclick = () => void save(true);
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!enabled()) return;
      if (ownEvent(event)) return;
      if (captured || ignored(event.target)) return;
      hovered = event
        .composedPath()
        .find((item) => item instanceof Element && !ignored(item)) as
        | Element
        | undefined;
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
  /** Classify a press: the inline text editor, Humagent UI, a native control, or page content. */
  function source(event: Event): 'editor' | 'own' | 'control' | 'page' {
    if (text.element && event.composedPath().includes(text.element))
      return 'editor';
    if (ownEvent(event)) return 'own';
    return isNativeInteractiveControl(eventElement(event) || null)
      ? 'control'
      : 'page';
  }
  function stop(event: Event, prevent = false) {
    if (prevent) event.preventDefault();
    event.stopImmediatePropagation();
  }
  /** While commenting is on, presses target elements before the page can act on them. */
  function intercept(event: MouseEvent) {
    const from = source(event);
    if (from === 'editor') return stop(event, event.type === 'click');
    if (from === 'own') return;
    const point = clickPoint(event);
    switch (event.type) {
      case 'pointerdown':
      case 'mousedown':
        if (changed()) stop(event, true);
        // A press on a control's plain label may start a text edit, so only that keeps its default.
        else if (enabled() && from === 'control')
          stop(
            event,
            !hitTestText({ x: event.clientX, y: event.clientY }, canEditText),
          );
        return;
      case 'click': {
        if (captured && outside()) return stop(event, true);
        if (ignored(event.target) || !enabled()) return;
        stop(event, true);
        if (document.getSelection()?.toString().trim()) return;
        const hit = point ? hitTestText(point, canEditText) : undefined;
        if (hit) showText(hit.node, hit.offset, hit.offset, undefined, point);
        else show(eventElement(event) || event.target, undefined, point);
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
    $('keyboard-hint').textContent =
      `Element ${cursor + 1} of ${candidates.length}. Arrow keys move. Enter opens feedback. Escape exits.`;
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
  function findTarget(target: ReviewTarget): Element | null {
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
  function resolve(draft: Draft): Element | null {
    const target = draft.item.target;
    if (
      !target ||
      draft.revision !== boot.revision ||
      target.url !== boot.sourceUrl
    )
      return null;
    return findTarget(target);
  }

  function place(el: HTMLElement, x: number, y: number) {
    const transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    if (el.style.transform !== transform) el.style.transform = transform;
  }
  function position() {
    scheduled = false;
    text.reconcile(previews);
    const available: Availability[] = [];
    const layouts: {
      draft: Draft;
      index: number;
      rect: DOMRect;
    }[] = [];
    drafts.forEach((draft, index) => {
      if (!draft.item.target) return;
      const el = resolve(draft);
      available.push({ id: draft.item.id, available: !!el });
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (inView(rect, innerHeight)) layouts.push({ draft, index, rect });
    });
    const target = captured ? findTarget(captured.target) : hovered;
    if (captured && target) captured.el = target;
    const highlighted = highlightedDraft
      ? drafts.find((draft) => draft.item.id === highlightedDraft)
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
    const panel = !$('panel').hidden ? $('panel') : null;
    const panelRect = panel?.getBoundingClientRect();
    const visible = new Set(layouts.map((layout) => layout.draft.item.id));
    for (const [id, marker] of markers) marker.hidden = !visible.has(id);
    for (const { draft, index, rect } of layouts) {
      let marker = markers.get(draft.item.id);
      if (!marker) {
        marker = document.createElement('button');
        marker.className = 'marker glass-surface';
        marker.dataset.draftId = draft.item.id;
        const activate = (event: MouseEvent) => {
          if (saving) return;
          if (captured && captured.draft?.item.id !== draft.item.id) close();
          edit(draft.item.id, clickPoint(event) || center(marker));
        };
        marker.onpointerdown = (event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.stopPropagation();
          activate(event);
        };
        marker.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          // Keyboard activation has no preceding pointer press.
          if (event.detail === 0) activate(event);
        };
        markers.set(draft.item.id, marker);
        $('markers').append(marker);
      }
      marker.hidden = false;
      marker.classList.toggle(
        'highlighted',
        draft.item.id === highlightedDraft,
      );
      const number = String(index + 1);
      if (marker.textContent !== number) marker.textContent = number;
      marker.ariaLabel = `Comment ${number}: ${draft.item.comment || 'Text edit'}`;
      marker.ariaExpanded = String(captured?.draft?.item.id === draft.item.id);
      const point = markerPoint(rect, draft.marker);
      place(marker, point.x, point.y);
    }
    $('highlight').hidden = !highlight;
    if (highlight) {
      place($('highlight'), highlight.left, highlight.top);
      $('highlight').style.width = `${highlight.width}px`;
      $('highlight').style.height = `${highlight.height}px`;
    }
    if (panel && panelRect && editorAnchor && captured) {
      const { x, y } = panelPoint(
        {
          x: editorAnchor.left + captured.point.x,
          y: editorAnchor.top + captured.point.y,
        },
        panelRect,
        {
          width: innerWidth,
          height: window.visualViewport?.height || innerHeight,
        },
      );
      panel.style.left = `${Math.round(x)}px`;
      panel.style.top = `${Math.round(y)}px`;
    }
    const signature = JSON.stringify(available);
    if (signature !== lastAvailability) {
      lastAvailability = signature;
      post('availability', { items: available });
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
  // Pages can block text selection with CSS. Selection must work while commenting.
  function syncSelection() {
    const sheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== selectionStyle,
    );
    document.adoptedStyleSheets = enabled()
      ? [...sheets, selectionStyle]
      : sheets;
  }
  return {
    outside,
    edit,
    highlight(draftId?: string) {
      highlightedDraft = draftId;
      schedule();
    },
    setMode,
    present(presentation: Presentation) {
      drafts = presentation.drafts;
      previews = presentation.previews;
      writable = presentation.writable;
      const ids = new Set(drafts.map((draft) => draft.item.id));
      if (highlightedDraft && !ids.has(highlightedDraft))
        highlightedDraft = undefined;
      for (const [id, marker] of markers)
        if (!ids.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      if (captured?.draft && !ids.has(captured.draft.item.id)) close(true);
      if (!writable) {
        syncSelection();
        post('mode', { enabled: false });
      }
      text.reconcile(previews);
      updateEditor();
      schedule();
    },
  };
}
