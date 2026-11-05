import { context, isNativeInteractiveControl } from './targets.js';
import type { Bootstrap } from '../shared/bridge.js';
import type { DraftItem, ReviewTarget } from '../shared/batch.js';
import type { Availability, Draft, StageResult } from '../shared/review.js';
import { errorMessage } from '../shared/errors.js';

interface ReviewBridge {
  boot: Bootstrap;
  stage(item: DraftItem): Promise<StageResult>;
  notice(message: string): void;
  availability(items: Availability[]): void;
  done(): void;
}
type Controls = Record<string, HTMLElement> & {
  note: HTMLTextAreaElement;
  after: HTMLTextAreaElement;
  editor: HTMLFormElement;
  comment: HTMLButtonElement;
  replace: HTMLButtonElement;
  close: HTMLButtonElement;
  cancel: HTMLButtonElement;
  add: HTMLButtonElement;
};
interface Capture {
  target: ReviewTarget &
    ReturnType<typeof context> & {
      url: string;
      revision: string;
      anchorId: string;
      anchor?: { quote: string; prefix: string; suffix: string };
    };
  before: string;
}

/** The page owns selection geometry. The workspace owns every persisted draft. */
export function createPageReview({
  boot,
  stage,
  notice,
  availability,
  done,
}: ReviewBridge) {
  const host = document.createElement('div');
  host.dataset.humagentUi = '';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:14px/1.5 system-ui,sans-serif;color:#202020}
    *{box-sizing:border-box} [hidden]{display:none!important}
    button,textarea{font:inherit} button{min-height:36px;padding:6px 10px;border:1px solid #d8d8d8;border-radius:5px;background:#fff;color:#202020;cursor:pointer}
    button:hover{background:#f1f1f1} button:disabled{color:#777;cursor:default} button:focus-visible,textarea:focus-visible{outline:2px solid #202020;outline-offset:2px}
    .primary{background:#202020;color:#fff;border-color:#202020}.primary:hover{background:#444}
    #panel,#picker{position:fixed;pointer-events:auto;background:#fff;box-shadow:0 6px 24px #0002;border-radius:8px;padding:12px;max-height:calc(100dvh - 24px);overflow:auto;width:min(340px,calc(100vw - 24px))}
    #picker{left:12px;top:12px} #toolbar,.actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .actions{margin-top:12px} textarea{display:block;width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;min-height:72px;resize:vertical;color:#202020;background:#fff}
    label{display:block;margin-top:10px} pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;max-height:100px;overflow:auto;background:#f4f4f4;padding:8px;margin:8px 0}
    #local-error{color:#a32222;margin:8px 0} #picker-name{display:block;margin:8px 0;overflow-wrap:anywhere} .hint{font-size:12px;color:#595959;margin:6px 0}
    .marker{position:fixed;display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#202020;color:#fff;font-size:12px;font-weight:600;border:2px solid white;pointer-events:none}
    #highlight{position:fixed;border:2px solid #202020;background:#00000006;pointer-events:none}
  </style>
  <div id="highlight" hidden></div><div id="markers"></div>
  <section id="picker" aria-label="Choose an element" hidden>
    <strong>Choose an element</strong><p class="hint">Click an element, or use the arrow keys and Enter. Escape cancels.</p>
    <span id="picker-name" aria-live="polite"></span><div class="actions"><button id="previous">Previous</button><button id="next">Next</button><button id="choose">Choose</button><button id="cancel-pick">Cancel</button></div>
  </section>
  <section id="panel" role="dialog" aria-label="Add feedback" hidden>
    <div id="toolbar"><button id="comment">Comment</button><button id="replace">Suggest replacement</button><button id="close">Close</button></div>
    <form id="editor" hidden><div id="original-wrap" hidden><p class="hint">Captured original</p><pre id="original"></pre><label>Exact replacement<textarea id="after" aria-label="Exact replacement" placeholder="Leave empty to propose deletion"></textarea></label></div>
    <label><span id="note-label">Comment</span><textarea id="note" aria-label="Comment"></textarea></label>
    <p id="local-error" role="alert" hidden></p><div class="actions"><button class="primary" id="add" type="submit">Add to review</button><button id="cancel" type="button">Cancel</button></div></form>
  </section>`;
  (document.body || document.documentElement).append(host);
  const $ = <K extends keyof Controls>(id: K): Controls[K] =>
    shadow.getElementById(id) as Controls[K];
  let captured: Capture | null = null;
  let replacement = false,
    picking = false,
    candidates: Element[] = [],
    cursor = 0,
    saving = false,
    drafts: Draft[] = [],
    scheduled = false,
    lastAvailability = '';
  const anchors = new Map<string, Element>(),
    bound = new Map<string, Element | null>();
  let returnFocus: Element | null;
  const ignored = (el: EventTarget | null) =>
    !(el instanceof Element) ||
    el.closest('[data-humagent-ui],script,style,head') ||
    el === document.documentElement;
  const exactText = (el: Element) => el.textContent || '';
  const normalizedText = (el: Element) => context(el).text;
  const nativeEvent = (event: Event) =>
    event.composedPath().some(isNativeInteractiveControl);
  function flush() {
    if (
      saving ||
      (!$('editor').hidden &&
        ($('note').value || $('after').value || replacement))
    )
      throw new Error('Add or cancel your current feedback before continuing.');
  }
  function canReplaceCapture() {
    try {
      flush();
      return true;
    } catch (error) {
      notice(errorMessage(error));
      return false;
    }
  }
  function highlight(el: Element | undefined) {
    if (!el?.isConnected) {
      $('highlight').hidden = true;
      return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign($('highlight').style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    $('highlight').hidden = false;
  }
  function close() {
    if (saving) return;
    $('panel').hidden = true;
    $('editor').hidden = true;
    if (
      captured &&
      !drafts.some(
        (draft) => draft.item.target?.anchorId === captured!.target.anchorId,
      )
    )
      anchors.delete(captured.target.anchorId);
    captured = null;
    if (
      returnFocus?.isConnected &&
      'focus' in returnFocus &&
      typeof returnFocus.focus === 'function'
    )
      returnFocus.focus({ preventScroll: true });
  }
  function fitPanel() {
    const rect = $('panel').getBoundingClientRect();
    $('panel').style.top =
      `${Math.max(12, Math.min(rect.top, innerHeight - rect.height - 12))}px`;
    $('panel').style.left =
      `${Math.max(12, Math.min(rect.left, innerWidth - rect.width - 12))}px`;
  }
  function cancel() {
    picking = false;
    $('picker').hidden = true;
    $('highlight').hidden = true;
    close();
    done();
  }
  function show(el: EventTarget | null, range?: Range) {
    if (!(el instanceof Element) || ignored(el) || !canReplaceCapture()) return;
    const before = range ? range.toString() : exactText(el);
    if (before.length > 50000) {
      notice('Select a smaller section (maximum 50,000 characters).');
      return;
    }
    const target: Capture['target'] = {
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
    anchors.set(target.anchorId, el);
    const allText = exactText(el);
    const uniqueQuote =
      !!before.trim() &&
      allText.indexOf(before) === allText.lastIndexOf(before) &&
      allText.includes(before);
    if (captured) anchors.delete(captured.target.anchorId);
    captured = { target, before };
    replacement = false;
    returnFocus = document.activeElement;
    const rect = range
      ? range.getBoundingClientRect()
      : el.getBoundingClientRect();
    $('panel').hidden = false;
    $('editor').hidden = true;
    $('note').value = '';
    $('after').value = '';
    $('replace').disabled =
      isNativeInteractiveControl(el) ||
      !!el.querySelector(
        'a[href],button,input,select,textarea,[contenteditable]',
      ) ||
      !uniqueQuote ||
      el === document.body;
    $('replace').title = $('replace').disabled
      ? 'Select unambiguous text outside interactive controls.'
      : '';
    const width = Math.min(340, innerWidth - 24);
    Object.assign($('panel').style, {
      left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`,
      top: `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - 220))}px`,
    });
    $('comment').focus({ preventScroll: true });
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
    const range = selection.getRangeAt(0).cloneRange();
    const node = range.commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    if (ignored(el) || isNativeInteractiveControl(el)) return false;
    show(el, range);
    return true;
  }
  for (const [id, replace] of [
    ['comment', false],
    ['replace', true],
  ] as const)
    $(id).onclick = () => {
      if (!captured) return;
      replacement = replace;
      $('editor').hidden = false;
      $('original-wrap').hidden = !replace;
      $('original').textContent = captured.before;
      $('note-label').textContent = replace ? 'Comment (optional)' : 'Comment';
      $('local-error').hidden = true;
      (replace ? $('after') : $('note')).focus();
      fitPanel();
    };
  $('close').onclick = close;
  $('cancel').onclick = close;
  $('editor').onsubmit = async (event) => {
    event.preventDefault();
    if (!captured) return;
    const item = {
      target: captured.target,
      ...(replacement
        ? { replacement: { before: captured.before, after: $('after').value } }
        : {}),
      ...($('note').value ? { comment: $('note').value } : {}),
    };
    saving = true;
    const disabled = [
      ...shadow.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>(
        '#panel button,#panel textarea',
      ),
    ].map((el) => [el, el.disabled] as const);
    for (const [el] of disabled) el.disabled = true;
    try {
      await stage(item);
      saving = false;
      close();
    } catch (error) {
      $('local-error').textContent = errorMessage(error);
      $('local-error').hidden = false;
    } finally {
      saving = false;
      for (const [el, previous] of disabled) el.disabled = previous;
    }
  };
  document.addEventListener('mouseup', (event) => {
    if (ignored(event.target) || picking || nativeEvent(event)) return;
    setTimeout(selectedText, 0);
  });
  document.addEventListener('dblclick', (event) => {
    if (!picking && !ignored(event.target) && !nativeEvent(event)) {
      if (!selectedText()) show(event.target);
    }
  });
  document.addEventListener('contextmenu', (event) => {
    if (event.shiftKey || ignored(event.target) || nativeEvent(event)) return;
    event.preventDefault();
    if (!selectedText()) show(event.target);
  });
  document.addEventListener(
    'click',
    (event) => {
      if (!picking || ignored(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      picking = false;
      $('picker').hidden = true;
      $('highlight').hidden = true;
      show(event.target);
    },
    true,
  );
  function cursorAt(offset: number) {
    if (!candidates.length) return;
    cursor = (cursor + offset + candidates.length) % candidates.length;
    const el = candidates[cursor]!;
    el.scrollIntoView({ block: 'nearest' });
    highlight(el);
    $('picker-name').textContent =
      `${cursor + 1} of ${candidates.length}: ${el.getAttribute('aria-label') || normalizedText(el) || el.tagName.toLowerCase()}`;
  }
  function choose() {
    const el = candidates[cursor];
    picking = false;
    $('picker').hidden = true;
    $('highlight').hidden = true;
    if (el) show(el);
  }
  $('previous').onclick = () => cursorAt(-1);
  $('next').onclick = () => cursorAt(1);
  $('choose').onclick = choose;
  $('cancel-pick').onclick = cancel;
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && (picking || !$('panel').hidden)) {
        event.preventDefault();
        cancel();
      } else if (
        picking &&
        ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)
      ) {
        event.preventDefault();
        cursorAt(['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1);
      } else if (picking && event.key === 'Enter' && event.target !== host) {
        event.preventDefault();
        choose();
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
    if (bound.has(draft.item.id)) {
      const el = bound.get(draft.item.id);
      return el?.isConnected &&
        normalizedText(el) === target.text &&
        (!anchor || exactText(el).includes(String(quote)))
        ? el
        : null;
    }
    let el =
      typeof target.anchorId === 'string'
        ? anchors.get(target.anchorId)
        : undefined;
    if (el && !el.isConnected) {
      bound.set(draft.item.id, null);
      return null;
    }
    if (!el) {
      try {
        const matches = target.id
          ? document.querySelectorAll(
              `[data-humagent-id="${CSS.escape(String(target.id))}"],#${CSS.escape(String(target.id))}`,
            )
          : document.querySelectorAll(String(target.selector || ''));
        if (matches.length !== 1) return null;
        el = matches[0];
      } catch {
        return null;
      }
    }
    if (!el || ignored(el) || normalizedText(el) !== target.text) return null;
    if (anchor && !exactText(el).includes(String(quote))) return null;
    bound.set(draft.item.id, el);
    return el;
  }
  function position() {
    scheduled = false;
    $('markers').replaceChildren();
    const available: Availability[] = [];
    drafts.forEach((draft, index) => {
      if (!draft.item.target) return;
      const el = resolve(draft);
      available.push({ id: draft.item.id, available: !!el });
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        rect.bottom < 0 ||
        rect.top > innerHeight
      )
        return;
      const marker = document.createElement('span');
      marker.className = 'marker';
      marker.dataset.draftId = draft.item.id;
      marker.textContent = String(index + 1);
      marker.setAttribute('aria-hidden', 'true');
      Object.assign(marker.style, {
        left: `${Math.max(0, Math.min(rect.left - 11, innerWidth - 23))}px`,
        top: `${Math.max(0, Math.min(rect.top - 11, innerHeight - 23))}px`,
      });
      $('markers').append(marker);
    });
    const signature = JSON.stringify(available);
    if (signature !== lastAvailability) {
      lastAvailability = signature;
      availability(available);
    }
    if (picking) highlight(candidates[cursor]);
    if (!$('panel').hidden) fitPanel();
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(position);
    }
  }
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('beforeunload', (event) => {
    try {
      flush();
    } catch {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  const observer = new MutationObserver(schedule);
  observer.observe(document.body || document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'id', 'data-humagent-id', 'hidden'],
  });
  return {
    cancel,
    flush,
    setDrafts(items: Draft[]) {
      drafts = items;
      const ids = new Set(items.map((draft) => draft.item.id));
      const references = new Set(
        items.map((draft) => draft.item.target?.anchorId),
      );
      for (const id of bound.keys()) if (!ids.has(id)) bound.delete(id);
      for (const id of anchors.keys())
        if (!references.has(id) && id !== captured?.target.anchorId)
          anchors.delete(id);
      schedule();
    },
    pick() {
      if (!canReplaceCapture()) return;
      close();
      candidates = [
        ...document.querySelectorAll(
          'h1,h2,h3,h4,p,li,td,th,img,a,button,input,select,textarea,label,[data-humagent-id],[role]',
        ),
      ]
        .filter((el) => !ignored(el) && el.getClientRects().length)
        .slice(0, 2000);
      if (!candidates.length) {
        notice('No visible targets are available.');
        return;
      }
      picking = true;
      cursor = 0;
      $('picker').hidden = false;
      cursorAt(0);
      $('choose').focus();
    },
  };
}
