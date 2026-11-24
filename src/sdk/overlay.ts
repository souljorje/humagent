/** The page overlay: comment panel, markers, highlight, and keyboard hint. It draws a model and reports input. */
import { autosize, clickPoint, setText } from '../shared/dom.js';
import { cssVariables } from '../shared/css-variables.js';
import { icon } from '../shared/icons.js';
import { inputStyles } from '../shared/input-styles.js';
import { materialStyles } from '../shared/material-styles.js';
import { installTooltips } from '../shared/tooltips.js';
import type { Point, Size } from './layout.js';

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
  removeDisabled: boolean;
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

export function createOverlayView(actions: OverlayActions) {
  const host = document.createElement('div');
  host.dataset.humagentUi = '';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host {
      ${cssVariables}
      --ha-bg-marker-active: color-mix(in srgb, var(--ha-smoke) 88%, transparent);
      --ha-bg-highlight: color-mix(in srgb, var(--ha-blue-500) calc(10 * 100% / 255), transparent);
      --ha-bg-keyboard-hint: var(--ha-gray-850);
      all: initial;
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483647;
      font: var(--ha-font-overlay);
      color: var(--ha-fg);
      color-scheme: dark;
    }
    *{box-sizing:border-box} [hidden]{display:none!important}
    button,textarea{font:inherit;color:inherit}
    button {
      border: 0;
      cursor: pointer;
      background: transparent;
      min-height: var(--ha-button-height);
      padding: var(--ha-padding-compact);
      border-radius: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--ha-spacing-1-5);
      transition: background var(--ha-control-duration), transform var(--ha-control-duration);
    }
    button:not(.glass-surface):hover{background:var(--ha-bg-hover)}
    button:active{transform:scale(.96)}
    button:disabled{opacity:var(--ha-control-disabled-opacity);cursor:default;transform:none}
    button:focus-visible{outline:2px solid var(--ha-focus-ring-strong);outline-offset:3px}
    #panel {
      position: fixed;
      z-index: 2;
      pointer-events: auto;
      border-radius: 22px;
      padding: var(--ha-panel-padding);
      max-height: calc(100dvh - 24px);
      overflow: auto;
      scrollbar-color: var(--ha-scrollbar-thumb) transparent;
      transition: opacity 160ms, transform 160ms cubic-bezier(.16,1,.3,1), display 160ms allow-discrete;
      width: min(360px, calc(100vw - 24px));
    }
    #panel[hidden]{opacity:0;transform:translateY(5px);pointer-events:none}
    @starting-style{#panel:not([hidden]){opacity:0;transform:translateY(5px)}}
    #editor{margin:0}.compose{display:flex;align-items:center;gap:var(--ha-spacing-2)}
    ${materialStyles}
    ${inputStyles}
    ::selection{background:var(--ha-bg-selection);color:var(--ha-fg-selection)}
    .primary{background:var(--ha-bg-primary);box-shadow:var(--ha-shadow-primary);color:var(--ha-fg-primary);flex-shrink:0}
    .primary:hover{background:var(--ha-bg-primary-hover)}
    .icon{width:var(--ha-button-height);padding:0}
    #actions{display:flex;align-items:center;gap:var(--ha-spacing-1-5);margin-top:var(--ha-spacing-2)}
    #actions>.tooltip-anchor:has(#remove){margin-right:auto}#actions>.tooltip-anchor:has(#cancel){margin-left:auto}#save{min-width:64px}
    #local-error,#editor-status {
      font-size: var(--ha-text-small);
      margin: var(--ha-spacing-1-5) var(--ha-spacing-2-5);
      color: var(--ha-fg-status);
    }
    .marker {
      position: fixed;
      pointer-events: auto;
      width: var(--ha-control-compact-size);
      min-height: var(--ha-control-compact-size);
      padding: 0;
      border-radius: 16px 16px 16px 5px;
      color: var(--ha-fg-bright);
      font-size: var(--ha-text-small);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      z-index: 1;
      transition: background var(--ha-control-duration);
    }
    .marker::before{content:'';position:absolute;inset:-6px}
    .marker:hover,.marker[aria-expanded=true],.marker.highlighted,.marker:focus-visible{--ha-glass-fill:var(--ha-bg-marker-active)}
    #highlight{position:fixed;outline:2px solid var(--ha-accent);outline-offset:-1px;background:var(--ha-bg-highlight);pointer-events:none}
    #keyboard-hint {
      position: fixed;
      left: 12px;
      top: 12px;
      padding: var(--ha-padding-compact);
      border-radius: var(--ha-radius-card);
      background: var(--ha-bg-keyboard-hint);
      color: var(--ha-fg-status);
      font-size: var(--ha-text-small);
    }
    @media(prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  </style>
  <div id="highlight" hidden></div><div id="markers"></div>
  <p id="keyboard-hint" hidden role="status"></p>
  <section id="panel" class="glass-surface" role="dialog" aria-label="Review" hidden>
    <form id="editor">
      <div class="compose"><textarea id="comment" class="feedback-input" aria-label="Comment" placeholder="Add a comment…" rows="1" maxlength="4000"></textarea><button class="primary icon" id="confirm" aria-label="Add comment" type="submit">${icon('check')}</button></div>
      <p id="editor-status" role="status" hidden>Read only</p><p id="local-error" role="alert" hidden></p>
      <div id="actions" hidden><button id="remove" class="icon" aria-label="Delete comment" type="button">${icon('trash')}</button><button id="cancel" type="button">Cancel</button><button class="primary" id="save" type="submit">Save</button></div>
    </form>
  </section>`;
  (document.body || document.documentElement).append(host);
  installTooltips(shadow);
  type Controls = Record<string, HTMLElement> & {
    editor: HTMLFormElement;
    comment: HTMLTextAreaElement;
    confirm: HTMLButtonElement;
    save: HTMLButtonElement;
    remove: HTMLButtonElement;
  };
  const $ = <K extends keyof Controls>(id: K): Controls[K] =>
    shadow.getElementById(id as string) as Controls[K];
  const markers = new Map<string, HTMLButtonElement>();

  function place(el: HTMLElement, x: number, y: number) {
    const transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    if (el.style.transform !== transform) el.style.transform = transform;
  }
  function createMarker(id: string) {
    const marker = document.createElement('button');
    marker.className = 'marker glass-surface';
    marker.dataset.reviewId = id;
    marker.onpointerdown = (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.stopPropagation();
      actions.marker(id, clickPoint(event), true);
    };
    marker.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Keyboard activation has no preceding pointer press.
      if (event.detail === 0) actions.marker(id, clickPoint(event), false);
    };
    markers.set(id, marker);
    $('markers').append(marker);
    return marker;
  }

  $('cancel').onclick = actions.cancel;
  $('comment').oninput = () => {
    autosize($('comment'));
    actions.comment($('comment').value);
  };
  $('comment').onkeydown = (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      actions.confirm();
    }
  };
  $('comment').onfocus = actions.commentFocus;
  $('editor').onsubmit = (event) => {
    event.preventDefault();
    actions.confirm();
  };
  $('remove').onclick = actions.remove;

  return {
    update(model: OverlayModel) {
      const { panel } = model;
      const opened = !!panel && $('panel').hidden;
      $('panel').hidden = !panel;
      if (panel) {
        $('confirm').setAttribute('aria-label', panel.confirmLabel);
        $('confirm').hidden = panel.existing;
        $('actions').hidden = !panel.existing;
        $('remove').hidden = !panel.existing;
        $('confirm').disabled = panel.confirmDisabled;
        $('save').disabled = panel.saveDisabled;
        $('remove').disabled = panel.removeDisabled;
        $('comment').readOnly = panel.readOnly;
        $('editor-status').hidden = !panel.locked;
        setText($('local-error'), panel.error);
        $('local-error').hidden = !panel.error;
        if (panel.position) {
          $('panel').style.left = `${Math.round(panel.position.x)}px`;
          $('panel').style.top = `${Math.round(panel.position.y)}px`;
        }
        if (opened) autosize($('comment'));
      }
      const pending = new Set(model.pendingIds);
      for (const [id, marker] of markers)
        if (!pending.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      const visible = new Set(model.markers.map((marker) => marker.id));
      for (const [id, marker] of markers) marker.hidden = !visible.has(id);
      for (const item of model.markers) {
        const marker = markers.get(item.id) || createMarker(item.id);
        marker.classList.toggle('highlighted', item.highlighted);
        setText(marker, item.number);
        marker.ariaLabel = item.label;
        marker.ariaExpanded = String(item.expanded);
        place(marker, item.x, item.y);
      }
      $('highlight').hidden = !model.highlight;
      if (model.highlight) {
        place($('highlight'), model.highlight.left, model.highlight.top);
        $('highlight').style.width = `${model.highlight.width}px`;
        $('highlight').style.height = `${model.highlight.height}px`;
      }
      $('keyboard-hint').hidden = model.hint === undefined;
      if (model.hint !== undefined) setText($('keyboard-hint'), model.hint);
    },
    /** Replace the comment field's text. */
    setComment(value: string) {
      $('comment').value = value;
      if (!$('panel').hidden) autosize($('comment'));
    },
    focusComment() {
      $('comment').focus({ preventScroll: true });
    },
    /** Shake the panel to show that input is unfinished. */
    shake() {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const panel = $('panel');
      panel.getAnimations().forEach((animation) => animation.cancel());
      panel.animate(
        [
          { translate: '0' },
          { translate: '-4px' },
          { translate: '4px' },
          { translate: '0' },
        ],
        { duration: 180 },
      );
    },
    /** Apply the height limit for the panel's width. Return the panel's size, or nothing while it is closed. */
    measurePanel(limit: (width: number) => number): Size | undefined {
      const panel = $('panel');
      if (panel.hidden) return undefined;
      panel.style.maxHeight = `${Math.max(0, limit(panel.offsetWidth))}px`;
      const rect = panel.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    },
    /** The marker of a pending item, for focus and geometry. */
    marker: (id: string): HTMLElement | undefined => markers.get(id),
  };
}
export type OverlayView = ReturnType<typeof createOverlayView>;
