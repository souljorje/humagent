import { context, isNativeInteractiveControl } from './targets.js';
import { createReviewView } from './review-view.js';
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
}

/** The page owns geometry and temporary editors. The parent owns saved feedback. */
export function createPageReview(bridge: ReviewBridge) {
  const { boot, stage, notice, availability } = bridge;
  const { $ } = createReviewView();
  const anchors = new Map<string, Element>();
  const bound = new Map<string, Element | null>();
  const markers = new Map<string, HTMLButtonElement>();
  let drafts: Draft[] = [],
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
  const ignored = (el: EventTarget | null) =>
    !(el instanceof Element) ||
    el.closest('[data-humagent-ui],script,style,head') ||
    el === document.documentElement;
  const exactText = (el: Element) => el.textContent || '';
  function matchesTarget(el: Element, target: ReviewTarget) {
    const current = context(el);
    return (
      current.text === target.text &&
      (target.id === undefined || current.id === String(target.id)) &&
      JSON.stringify(current.shadowPath || []) ===
        JSON.stringify(target.shadowPath || [])
    );
  }
  const isEditor = () => !$('panel').hidden;
  const mutable = () =>
    writable && (!captured?.draft || !locked.has(captured.draft.item.id));
  function changed() {
    if (!captured || !isEditor()) return false;
    return captured.draft
      ? $('note').value !== (captured.draft.item.comment || '') ||
          (replacement &&
            $('after').value !== captured.draft.item.replacement?.after)
      : !!$('note').value || replacement;
  }
  function updateEditor() {
    const dirty = saving || changed();
    if (lastDirty !== dirty) {
      lastDirty = dirty;
      bridge.editing(dirty);
    }
    const valid = replacement || !!$('note').value.trim();
    $('confirm').disabled = saving || !mutable() || !valid;
    $('save').disabled =
      saving || !mutable() || !valid || (!!captured?.draft && !changed());
    $('remove').disabled = saving || !mutable();
    $('note').readOnly = $('after').readOnly = saving || !mutable();
    $('editor-status').hidden = mutable();
    $('editor-status').textContent = locked.has(captured?.draft?.item.id || '')
      ? 'Awaiting confirmation'
      : 'Read only';
    for (const textarea of [$('note'), $('after')]) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(160, textarea.scrollHeight)}px`;
    }
    schedule();
  }
  function flush() {
    if (saving || changed())
      throw new Error('Save or cancel your feedback before continuing.');
  }
  function canChange() {
    try {
      flush();
      return true;
    } catch (error) {
      notice(errorMessage(error));
      $('note').focus();
      return false;
    }
  }
  function close(force = false) {
    if (saving && !force) return;
    $('panel').hidden = $('selection-menu').hidden = true;
    if (
      captured &&
      !drafts.some((d) => d.item.target?.anchorId === captured!.target.anchorId)
    )
      anchors.delete(String(captured.target.anchorId));
    captured = null;
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
    if (!canChange()) {
      bridge.mode(enabled);
      return;
    }
    close();
    enabled = value && writable;
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
  function showEditor(asReplacement = false) {
    if (!captured) return;
    replacement = asReplacement;
    $('selection-menu').hidden = true;
    $('panel').hidden = false;
    const existing = captured.draft?.item;
    $('note').value = existing?.comment || '';
    $('after').value = existing?.replacement?.after || '';
    $('original').textContent = captured.before;
    $('original').hidden = $('after').hidden = !replacement;
    $('note').placeholder = replacement
      ? 'Comment (optional)'
      : 'Leave a comment…';
    $('confirm').hidden = !!existing || replacement;
    $('actions').hidden = !existing && !replacement;
    $('remove').hidden = !existing;
    $('save').textContent = existing ? 'Save' : 'Add replacement';
    $('local-error').hidden = true;
    updateEditor();
    position();
    (replacement ? $('after') : $('note')).focus({ preventScroll: true });
  }
  function show(el: EventTarget | null, range?: Range) {
    if (!(el instanceof Element) || ignored(el) || !writable || !canChange())
      return;
    const before = range ? range.toString() : exactText(el);
    if (before.length > 50000) {
      notice('Select a smaller section (maximum 50,000 characters).');
      return;
    }
    close();
    returnFocus = document.activeElement;
    const target: ReviewTarget = {
      ...context(el),
      url: boot.sourceUrl,
      revision: boot.revision,
      anchorId: crypto.randomUUID(),
    };
    if (range) {
      const prefix = range.cloneRange(),
        suffix = range.cloneRange();
      prefix.selectNodeContents(document.body);
      prefix.setEnd(range.startContainer, range.startOffset);
      suffix.selectNodeContents(document.body);
      suffix.setStart(range.endContainer, range.endOffset);
      target.anchor = {
        quote: before,
        prefix: prefix.toString().slice(-32),
        suffix: suffix.toString().slice(0, 32),
      };
    }
    anchors.set(String(target.anchorId), el);
    watchRoots(el);
    captured = { target, before, el };
    if (range) {
      $('selection-menu').hidden = false;
      const text = exactText(el);
      $('replace').disabled =
        isNativeInteractiveControl(el) ||
        !!el.querySelector(
          'a[href],button,input,select,textarea,[contenteditable]',
        ) ||
        text.indexOf(before) !== text.lastIndexOf(before);
      position();
      $('comment').focus({ preventScroll: true });
    } else showEditor();
  }
  function edit(draftId: string) {
    const draft = drafts.find((d) => d.item.id === draftId);
    if (!draft || !canChange()) return;
    const el = resolve(draft);
    if (!el) {
      notice(
        'Target unavailable. Inspect or remove this feedback in pending items.',
      );
      return;
    }
    close();
    returnFocus = markers.get(draftId) || document.activeElement;
    captured = {
      target: draft.item.target!,
      before: draft.item.replacement?.before || exactText(el),
      el,
      draft,
    };
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    showEditor(!!draft.item.replacement);
  }
  function selectedText() {
    const selection = document.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !selection.toString().trim()
    )
      return false;
    const range = selection.getRangeAt(0).cloneRange(),
      node = range.commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    if (ignored(el) || isNativeInteractiveControl(el)) return false;
    show(el, range);
    return true;
  }
  $('comment').onclick = () => showEditor();
  $('replace').onclick = () => showEditor(true);
  $('cancel').onclick = cancel;
  $('note').oninput = $('after').oninput = updateEditor;
  async function save(remove = false) {
    if (!captured || saving || !mutable()) return;
    const current = captured;
    saving = true;
    updateEditor();
    try {
      if (remove && current.draft) await bridge.remove(current.draft.item.id);
      else if (current.draft)
        await bridge.edit({
          draftId: current.draft.item.id,
          comment: $('note').value,
          ...(replacement ? { after: $('after').value } : {}),
        });
      else
        await stage({
          target: current.target,
          ...($('note').value ? { comment: $('note').value } : {}),
          ...(replacement
            ? {
                replacement: {
                  before: current.before,
                  after: $('after').value,
                },
              }
            : {}),
        });
      saving = false;
      close();
    } catch (error) {
      $('local-error').textContent = errorMessage(error);
      $('local-error').hidden = false;
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
      if (!enabled || captured || ignored(event.target)) return;
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
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        enabled &&
        !ignored(event.target) &&
        isNativeInteractiveControl(event.target)
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
      if (ignored(event.target)) return;
      if (!enabled) {
        if (!changed()) close();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim())
        return;
      show(
        event.composedPath().find((item) => item instanceof Element) ||
          event.target,
      );
    },
    true,
  );
  document.addEventListener('mouseup', (event) => {
    if (
      enabled &&
      !ignored(event.target) &&
      !isNativeInteractiveControl(event.target)
    )
      setTimeout(selectedText, 0);
  });
  document.addEventListener('keyup', (event) => {
    if (enabled && event.shiftKey && !ignored(event.target)) selectedText();
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
        show(hovered);
      }
    },
    true,
  );
  function resolve(draft: Draft): Element | null {
    const target = draft.item.target;
    if (
      !target ||
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
        rect.width &&
        rect.height &&
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
    const panel = !$('panel').hidden
      ? $('panel')
      : !$('selection-menu').hidden
        ? $('selection-menu')
        : null;
    const panelRect = panel?.getBoundingClientRect();
    const visible = new Set(layouts.map((layout) => layout.draft.item.id));
    for (const [id, marker] of markers) marker.hidden = !visible.has(id);
    for (const { draft, index, rect, offset } of layouts) {
      let marker = markers.get(draft.item.id);
      if (!marker) {
        marker = document.createElement('button');
        marker.className = 'marker';
        marker.dataset.draftId = draft.item.id;
        marker.onclick = () => edit(draft.item.id);
        markers.set(draft.item.id, marker);
        $('markers').append(marker);
      }
      marker.hidden = false;
      marker.textContent = String(index + 1);
      marker.setAttribute(
        'aria-label',
        `Comment ${index + 1}: ${draft.item.comment || 'Suggested replacement'}`,
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
    if (panel && panelRect && highlight) {
      const viewportHeight = window.visualViewport?.height || innerHeight;
      const fitsRight =
        highlight.right + 10 + panelRect.width <= innerWidth - 12;
      const fitsLeft = highlight.left - 10 - panelRect.width >= 12;
      const x = fitsRight
        ? highlight.right + 10
        : fitsLeft
          ? highlight.left - panelRect.width - 10
          : Math.max(
              12,
              Math.min(highlight.left, innerWidth - panelRect.width - 12),
            );
      const preferredY =
        fitsRight || fitsLeft
          ? highlight.top - 12
          : highlight.bottom + 10 + panelRect.height <= viewportHeight - 12
            ? highlight.bottom + 10
            : highlight.top - panelRect.height - 10;
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
  const observer = new MutationObserver(schedule);
  const observed = new WeakSet<ShadowRoot>();
  const observation = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'id', 'data-humagent-id', 'hidden'],
  };
  observer.observe(document.body || document.documentElement, observation);
  function watchRoots(el: Element) {
    let root = el.getRootNode();
    while (root instanceof ShadowRoot) {
      if (!observed.has(root)) {
        observer.observe(root, observation);
        observed.add(root);
      }
      root = root.host.getRootNode();
    }
  }
  return {
    flush,
    edit,
    setMode,
    end() {
      enabled = false;
      writable = false;
      bridge.mode(false);
      updateEditor();
      schedule();
    },
    setDrafts(presentation: ReviewPresentation) {
      drafts = presentation.items;
      locked = new Set(presentation.locked);
      writable = presentation.writable;
      const ids = new Set(drafts.map((draft) => draft.item.id));
      const references = new Set(
        drafts.map((draft) => draft.item.target?.anchorId),
      );
      for (const id of bound.keys()) if (!ids.has(id)) bound.delete(id);
      for (const [id, marker] of markers)
        if (!ids.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      for (const id of anchors.keys())
        if (!references.has(id) && id !== captured?.target.anchorId)
          anchors.delete(id);
      if (captured?.draft && !ids.has(captured.draft.item.id)) close(true);
      if (!writable) enabled = false;
      updateEditor();
      schedule();
    },
  };
}
